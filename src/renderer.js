// WebGL2 renderer. Two passes, no per-pixel loops over particles:
//   1. Instanced point sprites accumulate into two float targets. Each sprite is a Gaussian feather evaluated
//      once per fragment of its own quad. Target A holds sum(colour · a²) and sum(a²); target B holds sum(a).
//   2. A full-screen composite divides the colour by the squared-weight sum (so overlapping dots keep their hue
//      instead of averaging to grey), applies the presence amount 1 - exp(-2.4·Σa), and mixes over the ground.
// Needs EXT_color_buffer_float for the float targets.

const SPRITE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aCenter;
layout(location=2) in float aRadius;
layout(location=3) in vec3 aColor;
layout(location=4) in float aDepth;
layout(location=5) in float aSeed;
uniform vec2 uRes;
uniform float uTime;
uniform float uDark; // 0 light ground, 1 dark ground: saturation and lift for the dots
out vec2 vLocal;
out vec3 vColor;
out float vDepth;
out float vFirm;
out float vBreath;
const float SUPPORT = 2.0; // quad half-size in radii; the soft orbs fall to zero by 1.55 radii
const float PI = 3.14159265;
void main() {
  float s = aSeed;
  float ph = fract(s * 7.31) * 2.0 * PI;
  // Breathing: every ball has its own rate (period about 2.5 to 7 s) and phase, and a second, slower harmonic on
  // another phase, so the dots never swell together. Size ±12%, brightness ±10%, feather varies in the fragment shader.
  float omega = 0.9 + 0.9 * fract(s * 13.7);
  float breath = sin(uTime * omega + ph);
  float breath2 = sin(uTime * omega * 0.61 + ph * 2.9);
  float r = aRadius * (1.0 + 0.17 * breath + 0.05 * breath2);
  // Depth class per ball, fixed for life: about a third are firm (crisp edge, tight core), the rest soft and diffuse.
  // Crisp class: about one ball in five. Only small-to-medium balls (radius up to about 0.04 of the canvas height,
  // a viewport-independent size) can be crisp, and about half of those are; large balls are all soft.
  // Tiny balls (under about 16 px) stay soft, so no small hard specks appear.
  float rel = aRadius / uRes.y;
  float sizeOk = 1.0 - smoothstep(0.038, 0.042, rel);
  vFirm = step(0.5, fract(s * 3.7)) * sizeOk * smoothstep(7.0, 16.0, aRadius);
  vBreath = breath;
  // Colour drift: a slow move toward the rotated channels (about a 40 s cycle), so the hue wanders within its family.
  float drift = sin(uTime * 0.16 + ph * 1.7);
  // Dropout: a few balls (about 12%) fade out once per long cycle (11 to 23 s) and reappear a little away.
  // The fade is centred on the middle of each window; the reappearing spot shifts while the ball is at zero size.
  float gate = step(0.88, fract(s * 5.1));
  float period = 11.0 + 12.0 * fract(s * 29.3);
  float x = uTime + fract(s * 41.7) * period - 0.9;
  float k = floor(x / period + 0.5);
  float d = x - k * period;
  float bump = gate * (1.0 - smoothstep(0.0, 0.9, abs(d)));
  r *= 1.0 - bump;
  float side = mod(k, 2.0) * gate;
  vec2 dir = vec2(cos(ph * 2.3 + s * 6.0), sin(ph * 2.3 + s * 6.0));
  vec2 c = aCenter + dir * aRadius * 1.4 * side;
  vec2 p = c + aCorner * r * SUPPORT;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  vLocal = aCorner * SUPPORT;
  vec3 col = mix(aColor, aColor.yzx, 0.10 * drift) * (1.0 + 0.14 * breath);
  // Dark ground: push saturation and lift value a little so the orbs stay vivid and countable.
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(vec3(lum), col, 1.0 + 0.3 * uDark) * (1.0 + 0.08 * uDark);
  vColor = col;
  vDepth = aDepth;
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vColor;
in float vDepth;
in float vFirm;
in float vBreath;
layout(location=0) out vec4 outAcc;
layout(location=1) out float outSum;
void main() {
  // One round orb per ball, so it counts as one colour. Firm balls (vFirm 1): a crisp rim (its width breathes, so
  // the edge sharpens and softens) and a faint inner gradient. Soft balls (vFirm 0): a plateau with a wide, gentle
  // fall-off that also breathes. Nearer balls (large vDepth) keep more strength; farther ones recede.
  float dist = length(vLocal);
  float rimW = 0.05 + 0.035 * vBreath;
  float firm = (1.0 - smoothstep(1.0 - rimW, 1.0, dist)) * (0.84 + 0.16 * (1.0 - dist)) * (0.75 + 0.25 * vDepth);
  float softW = 1.55 + 0.25 * vBreath;
  float soft = 0.5 * (1.0 - smoothstep(0.3, softW, dist)) * (0.6 + 0.4 * vDepth);
  float a = mix(soft, firm, vFirm);
  if (a < 0.002) discard;
  float a2 = a * a;
  // Depth weights the colour average: where two balls overlap, the nearer one (larger vDepth) takes more of the
  // mixed hue, so it reads as in front. The coverage sum stays depth-free.
  float w = a2 * vDepth;
  outAcc = vec4(vColor * w, w);
  outSum = a;
}`;

const COMP_VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uAcc;
uniform sampler2D uSum;
uniform vec2 uRes;
uniform vec3 uTop;
uniform vec3 uBot;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float screenY = 1.0 - uv.y; // 0 at the top
  vec4 acc = texture(uAcc, uv);
  float wsum = texture(uSum, uv).r;
  vec3 mixed = acc.rgb / max(acc.a, 1e-4);
  float amount = 1.0 - exp(-2.4 * wsum); // soft cores stay saturated; the outer halo fades into the ground
  vec3 bg = mix(uTop, uBot, screenY) + 0.03 * (vnoise(gl_FragCoord.xy * 0.004) - 0.5);
  fragColor = vec4(mix(bg, mixed, amount), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

  const spriteProg = program(gl, SPRITE_VS, SPRITE_FS);
  const compProg = program(gl, COMP_VS, COMP_FS);
  const uRes = gl.getUniformLocation(spriteProg, 'uRes');
  const uTime = gl.getUniformLocation(spriteProg, 'uTime');
  const uDark = gl.getUniformLocation(spriteProg, 'uDark');
  const cUniform = {
    acc: gl.getUniformLocation(compProg, 'uAcc'),
    sum: gl.getUniformLocation(compProg, 'uSum'),
    res: gl.getUniformLocation(compProg, 'uRes'),
    top: gl.getUniformLocation(compProg, 'uTop'),
    bot: gl.getUniformLocation(compProg, 'uBot'),
  };

  // Static quad corners, shared by every instance.
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const instBuf = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  const STRIDE = 32; // 8 floats per instance: x, y, radius, r, g, b, depth, seed
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE, 12);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, STRIDE, 24);
  gl.vertexAttribDivisor(4, 1);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 1, gl.FLOAT, false, STRIDE, 28);
  gl.vertexAttribDivisor(5, 1);
  gl.bindVertexArray(null);

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  const aPos = gl.getAttribLocation(compProg, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Accumulation targets, rebuilt on resize.
  let W = 0;
  let H = 0;
  let fbo = null;
  let texAcc = null;
  let texSum = null;

  function allocTargets(w, h) {
    for (const t of [texAcc, texSum]) if (t) gl.deleteTexture(t);
    if (fbo) gl.deleteFramebuffer(fbo);
    texAcc = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texAcc);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    texSum = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texSum);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texAcc, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, texSum, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`accumulation framebuffer incomplete (${status})`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    W = w;
    H = h;
  }

  function resize(w, h) {
    if (w === W && h === H) return;
    canvas.width = w;
    canvas.height = h;
    allocTargets(w, h);
  }

  /**
   * Draws `count` instances (8 floats each: x, y, radius, r, g, b, depth, seed) over the ground colours `top` and `bot`.
   * `time` is seconds; the shader uses it for breathing, hue drift and dropout. `dark` lifts the dots for a dark ground.
   */
  function draw(data, count, top, bot, time, dark = false) {
    // Pass 1: accumulate.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(spriteProg);
    gl.uniform2f(uRes, W, H);
    gl.uniform1f(uTime, time);
    gl.uniform1f(uDark, dark ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 8), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);

    // Pass 2: composite to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(compProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texAcc);
    gl.uniform1i(cUniform.acc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texSum);
    gl.uniform1i(cUniform.sum, 1);
    gl.uniform2f(cUniform.res, W, H);
    gl.uniform3f(cUniform.top, top[0], top[1], top[2]);
    gl.uniform3f(cUniform.bot, bot[0], bot[1], bot[2]);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  return { resize, draw, rendererName, size: () => ({ W, H }) };
}
