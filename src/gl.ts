import type { Head } from './body';
import type { Mesh } from './rig';

const BG_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const BG_FS = `#version 300 es
precision mediump float;
uniform sampler2D uSrc;
in vec2 vUv;
out vec4 o;
void main() { o = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

const G_VS = `#version 300 es
in vec2 aPos;
in vec2 aUv;
uniform vec2 uRes;
out vec2 vUv;
out vec2 vPx;
void main() {
  vUv = aUv;
  vPx = aPos;
  vec2 c = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const G_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec3 uTint;
uniform float uShade;
uniform float uShadeRef;
uniform float uLight;
uniform float uNoise;
uniform float uSeed;
uniform float uHeadOn;
uniform vec2 uHeadC;
uniform vec4 uHeadAxes;
uniform vec2 uHeadR;
in vec2 vUv;
in vec2 vPx;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 c = texture(uTex, vUv);
  if (c.a < 0.004) discard;
  vec3 rgb = c.rgb * uLight * uTint;
  // Borrow the broad light and shadow of the scene (folds, side lighting) from the camera image
  // under the garment: its brightness relative to the torso average, at a coarse scale.
  vec3 under = textureLod(uSrc, vPx / uRes, 4.5).rgb;
  float ul = dot(under, vec3(0.299, 0.587, 0.114));
  float ratio = clamp(ul / max(uShadeRef, 0.05), 0.35, 2.4);
  float shade = clamp(pow(ratio, 0.55), 0.62, 1.3);
  rgb *= mix(1.0, shade, uShade);
  // sensor-like grain so the garment shares the video's texture
  float n = (hash(floor(vPx * 0.7) + uSeed) - 0.5) * uNoise;
  rgb = max(rgb + vec3(n) * c.a, 0.0);
  float m = 1.0;
  if (uHeadOn > 0.5) {
    vec2 r = vPx - uHeadC;
    vec2 q = vec2(dot(r, uHeadAxes.xy) / uHeadR.x, dot(r, uHeadAxes.zw) / uHeadR.y);
    m = smoothstep(0.85, 1.2, length(q));
  }
  o = vec4(rgb, c.a) * m;
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

export interface GarmentGpu {
  tex: WebGLTexture;
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  count: number;
  indexCount: number;
}

export interface FrameOptions {
  light: number;
  tint: [number, number, number];
  shade: number;
  shadeRef: number;
  noise: number;
  head: Head | null;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private bg: WebGLProgram;
  private gp: WebGLProgram;
  private bgVao: WebGLVertexArrayObject;
  private srcTex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private bgSrc: WebGLUniformLocation | null = null;
  private seed = 0;
  width = 0;
  height = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is not available in this browser');
    this.gl = gl;
    this.bg = program(gl, BG_VS, BG_FS);
    this.gp = program(gl, G_VS, G_FS);

    // full-screen triangle pair for the camera image
    this.bgVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.bgVao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.bg, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // the camera image / photo lives on texture unit 1 (garments use unit 0); its filtering is set in drawSource
    this.srcTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.activeTexture(gl.TEXTURE0);

    for (const name of ['uRes', 'uTex', 'uSrc', 'uTint', 'uShade', 'uShadeRef', 'uLight', 'uNoise', 'uSeed', 'uHeadOn', 'uHeadC', 'uHeadAxes', 'uHeadR']) {
      this.u[name] = gl.getUniformLocation(this.gp, name);
    }
    this.bgSrc = gl.getUniformLocation(this.bg, 'uSrc');
  }

  resize(w: number, h: number) {
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  /** Uploads the camera frame / photo and draws it as the background. */
  drawSource(source: TexImageSource) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(this.bg);
    gl.uniform1i(this.bgSrc, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.bgVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Creates GPU buffers and the texture for a garment mesh. */
  upload(mesh: Mesh, image: HTMLCanvasElement | ImageBitmap): GarmentGpu {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.count * 2 * 4, gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(this.gp, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(this.gp, 'aUv');
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    const idx = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    return { tex, vao, posBuf, count: mesh.count, indexCount: mesh.index.length };
  }

  release(g: GarmentGpu) {
    const gl = this.gl;
    gl.deleteTexture(g.tex);
    gl.deleteBuffer(g.posBuf);
    gl.deleteVertexArray(g.vao);
  }

  beginGarments(opts: FrameOptions) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.gp);
    gl.uniform2f(this.u.uRes, this.width, this.height);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniform1i(this.u.uSrc, 1);
    gl.uniform1f(this.u.uLight, opts.light);
    gl.uniform3f(this.u.uTint, opts.tint[0], opts.tint[1], opts.tint[2]);
    gl.uniform1f(this.u.uShade, opts.shade);
    gl.uniform1f(this.u.uShadeRef, opts.shadeRef);
    gl.uniform1f(this.u.uNoise, opts.noise);
    this.seed = (this.seed + 1) % 97;
    gl.uniform1f(this.u.uSeed, this.seed);
    const h = opts.head;
    gl.uniform1f(this.u.uHeadOn, h ? 1 : 0);
    if (h) {
      gl.uniform2f(this.u.uHeadC, h.c.x, h.c.y);
      gl.uniform4f(this.u.uHeadAxes, h.ax.x, h.ax.y, h.ay.x, h.ay.y);
      gl.uniform2f(this.u.uHeadR, h.rx, h.ry);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  drawGarment(g: GarmentGpu, positions: Float32Array) {
    const gl = this.gl;
    gl.bindVertexArray(g.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.bindTexture(gl.TEXTURE_2D, g.tex);
    gl.drawElements(gl.TRIANGLES, g.indexCount, gl.UNSIGNED_SHORT, 0);
  }
}
