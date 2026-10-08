"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { seaRenderBudget } from "@/lib/catan-render-budget";

type SeaCameraLayout = { size: number; x: number; y: number };
type SeaLayout = SeaCameraLayout & { width: number; height: number; active: boolean; interacting?: boolean; ambientEnabled?: boolean };
export type CatanSeaHandle = { setCameraLayout: (camera: SeaCameraLayout) => void };
const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
const FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_viewport;
uniform vec2 u_textureSize;
uniform vec3 u_sea;
uniform float u_time;
uniform float u_ambient;
void main() {
  vec2 screen = vec2(v_uv.x, 1.0 - v_uv.y) * u_viewport;
  vec2 origin = (u_viewport - vec2(u_sea.x)) * 0.5 + u_sea.yz;
  vec2 uv = (screen - origin) / u_sea.x;
  vec2 p = uv * u_textureSize;
  float phase = u_time * 6.28318530718 / 4.5;
  vec2 wave = 1.8 * vec2(
    2.25 * sin(phase + p.y / 72.0) + 0.75 * sin(2.0 * phase + p.x / 118.0 + p.y / 160.0),
    1.5 * cos(phase + p.x / 96.0 - p.y / 128.0) + 0.5 * sin(2.0 * phase + p.y / 110.0)
  );
  vec4 paintedSea = texture2D(u_texture, clamp(uv + wave / u_textureSize, 0.0, 1.0));
  float reflection = 1.0 + u_ambient * 0.015 * sin(u_time * 6.28318530718 / 30.0 + p.x / 260.0 + p.y / 340.0);
  gl_FragColor = vec4(paintedSea.rgb * reflection, paintedSea.a);
}`;

/** One bounded texture draw; camera gestures freeze the decorative wave phase. */
export function CatanSeaBackground({ ref, ...props }: SeaLayout & { ref?: Ref<CatanSeaHandle> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layout = useRef(props);
  const syncRef = useRef<(() => void) | null>(null);
  const cameraPaintRef = useRef<(() => void) | null>(null);
  useImperativeHandle(ref, () => ({ setCameraLayout: (camera) => {
    if (layout.current.size === camera.size && layout.current.x === camera.x && layout.current.y === camera.y) return;
    layout.current = { ...layout.current, ...camera };
    cameraPaintRef.current?.();
  } }), []);
  useLayoutEffect(() => { layout.current = props; syncRef.current?.(); }, [props]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handheld = window.matchMedia("(pointer: coarse), (max-width: 639px)");
    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let texture: WebGLTexture | null = null;
    let shaders: WebGLShader[] = [];
    let uniforms: Record<string, WebGLUniformLocation | null> = {};
    let image: HTMLImageElement | null = null;
    let ready = false; let failed = false; let disposed = false;
    let frame: number | null = null; let previousTime: number | null = null; let lastPaint: number | null = null; let time = 0;

    function pause() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null; previousTime = null; lastPaint = null;
    }
    function stop() {
      pause();
      canvas!.style.opacity = "0";
      canvas!.parentElement?.setAttribute("data-catan-sea-ready", "false");
      fallback();
    }
    function fallback() {
      const viewport = canvas!.parentElement;
      const { size, x, y } = layout.current;
      viewport?.style.setProperty("--catan-sea-size", `${size}px`);
      viewport?.style.setProperty("--catan-sea-x", `${x}px`);
      viewport?.style.setProperty("--catan-sea-y", `${y}px`);
    }
    function release() {
      ready = false;
      if (gl) {
        if (texture) gl.deleteTexture(texture);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        shaders.forEach((shader) => gl!.deleteShader(shader));
      }
      gl = null; texture = null; buffer = null; program = null; shaders = []; uniforms = {};
    }
    function upload() {
      if (disposed || !gl || !texture || !image?.naturalWidth) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.uniform2f(uniforms.u_textureSize, image.naturalWidth, image.naturalHeight);
      ready = true;
      sync();
    }
    function initialize() {
      try {
        gl = canvas!.getContext("webgl", { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
        if (!gl || gl.isContextLost()) throw new Error("Sea rendering unavailable");
        const compile = (type: number, source: string) => {
          const shader = gl!.createShader(type);
          if (!shader) throw new Error("Sea shader unavailable");
          shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader);
          if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error("Sea shader failed");
          return shader;
        };
        const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? "highp" : "mediump";
        const vertex = compile(gl.VERTEX_SHADER, VERTEX);
        const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT.replace("precision highp", `precision ${precision}`));
        program = gl.createProgram();
        if (!program) throw new Error("Sea program unavailable");
        gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Sea program failed");
        gl.useProgram(program);
        for (const name of ["u_texture", "u_viewport", "u_textureSize", "u_sea", "u_time", "u_ambient"]) uniforms[name] = gl.getUniformLocation(program, name);
        buffer = gl.createBuffer(); texture = gl.createTexture();
        if (!buffer || !texture) throw new Error("Sea buffers unavailable");
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "a_position");
        if (position < 0) throw new Error("Sea geometry unavailable");
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(uniforms.u_texture, 0);
        if (image?.complete && image.naturalWidth) upload();
        else if (!image) {
          image = new Image(); image.onload = upload;
          image.onerror = () => { failed = true; stop(); release(); };
          image.src = "/catan/sea-v3.jpg";
        }
      } catch {
        failed = true; stop(); release();
      }
    }
    function draw() {
      if (!canRender() || !ready || !gl) return;
      const { width, height, size, x, y } = layout.current;
      const { width: pixelWidth, height: pixelHeight } = seaRenderBudget(layout.current, window.devicePixelRatio || 1, handheld.matches);
      if (canvas!.width !== pixelWidth || canvas!.height !== pixelHeight) { canvas!.width = pixelWidth; canvas!.height = pixelHeight; }
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.uniform2f(uniforms.u_viewport, width, height); gl.uniform3f(uniforms.u_sea, size, x, y);
      gl.uniform1f(uniforms.u_ambient, layout.current.ambientEnabled === false ? 0 : 1);
      gl.uniform1f(uniforms.u_time, time); gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (canvas!.style.opacity !== "1") canvas!.style.opacity = "1";
      canvas!.parentElement?.setAttribute("data-catan-sea-ready", "true");
    }
    function tick(now: number) {
      frame = null;
      if (!canAnimate() || !ready || !gl) { sync(); return; }
      if (previousTime !== null) time = (time + (now - previousTime) / 1000) % 90;
      previousTime = now;
      const { interval } = seaRenderBudget(layout.current, window.devicePixelRatio || 1, handheld.matches);
      if (lastPaint === null || now - lastPaint >= interval - .5) { draw(); lastPaint = now; }
      frame = requestAnimationFrame(tick);
    }
    function canRender() { return !disposed && !failed && layout.current.active && !document.hidden && !motion.matches; }
    function canAnimate() { return canRender() && !layout.current.interacting; }
    function sync() {
      if (!canRender()) { stop(); return; }
      if (!gl) initialize();
      if (layout.current.interacting) pause();
      draw();
      if (ready && frame === null && canAnimate()) frame = requestAnimationFrame(tick);
    }
    function paintCamera() {
      if (!canRender() || !ready) { fallback(); return; }
      // Called inside the camera's rAF: no React update or second animation loop.
      draw();
    }
    const lost = (event: Event) => { event.preventDefault(); failed = true; stop(); release(); };
    const restored = () => { failed = false; sync(); };
    canvas.addEventListener("webglcontextlost", lost); canvas.addEventListener("webglcontextrestored", restored);
    document.addEventListener("visibilitychange", sync); motion.addEventListener("change", sync); handheld.addEventListener("change", sync);
    syncRef.current = sync; cameraPaintRef.current = paintCamera; sync();
    return () => {
      disposed = true; syncRef.current = null; cameraPaintRef.current = null; stop(); release();
      if (image) { image.onload = null; image.onerror = null; }
      canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", restored);
      document.removeEventListener("visibilitychange", sync); motion.removeEventListener("change", sync); handheld.removeEventListener("change", sync);
    };
  }, []);

  return <canvas ref={canvasRef} className="catan-sea-surface" aria-hidden="true" />;
}
