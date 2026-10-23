'use client';

import { useEffect, useRef } from 'react';

/**
 * A field of threads deformed in the vertex shader. It is the only 3D element
 * on the entry page, and it is built with raw three.js so the bundle stays
 * small and the render loop stays predictable.
 */
export function WeaveCanvas({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let frame = 0;
    let cleanup = () => {};

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    (async () => {
      const THREE = await import('three');
      if (disposed) return;

      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      } catch {
        return;
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearAlpha(0);
      host.appendChild(renderer.domElement);
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
      camera.position.set(0, 0, 8.4);

      const SPAN_X = 15;
      const SPAN_Y = 8.6;
      const COLUMNS = 44;
      const ROWS = 26;
      const SEGMENTS = 44;

      const positions: number[] = [];
      const seeds: number[] = [];
      const tints: number[] = [];

      const push = (x: number, y: number, seed: number, tint: number) => {
        positions.push(x, y, 0);
        seeds.push(seed);
        tints.push(tint);
      };

      for (let c = 0; c < COLUMNS; c += 1) {
        const x = -SPAN_X / 2 + (c / (COLUMNS - 1)) * SPAN_X;
        const seed = c * 0.37;
        const tint = c % 7 === 3 ? 1 : 0;
        for (let s = 0; s < SEGMENTS; s += 1) {
          const y0 = -SPAN_Y / 2 + (s / SEGMENTS) * SPAN_Y;
          const y1 = -SPAN_Y / 2 + ((s + 1) / SEGMENTS) * SPAN_Y;
          push(x, y0, seed, tint);
          push(x, y1, seed, tint);
        }
      }

      for (let r = 0; r < ROWS; r += 1) {
        const y = -SPAN_Y / 2 + (r / (ROWS - 1)) * SPAN_Y;
        const seed = r * 0.61 + 4.2;
        const tint = r % 5 === 2 ? 1 : 0;
        for (let s = 0; s < SEGMENTS; s += 1) {
          const x0 = -SPAN_X / 2 + (s / SEGMENTS) * SPAN_X;
          const x1 = -SPAN_X / 2 + ((s + 1) / SEGMENTS) * SPAN_X;
          push(x0, y, seed, tint);
          push(x1, y, seed, tint);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
      geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tints, 1));

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uPointer: { value: new THREE.Vector2(0, 0) },
          uInk: { value: new THREE.Color('#3a4a63') },
          uCopper: { value: new THREE.Color('#a8703f') },
          uOpacity: { value: 0.34 },
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform vec2 uPointer;
          attribute float aSeed;
          attribute float aTint;
          varying float vFade;
          varying float vTint;
          varying float vLift;

          void main() {
            vec3 p = position;
            float d = length(p.xy - uPointer * vec2(7.0, 3.6));
            float wave =
              sin(p.x * 0.52 + uTime * 0.28 + aSeed) * 0.58 +
              sin(p.y * 0.82 - uTime * 0.21 + aSeed * 0.8) * 0.34 +
              sin((p.x + p.y) * 0.4 + uTime * 0.15) * 0.20;
            float pull = exp(-d * 0.42) * 0.95;
            p.z += wave - pull;
            p.x += sin(p.y * 0.7 + uTime * 0.18 + aSeed * 0.4) * 0.16;
            p.xy *= 1.0 - p.z * 0.03;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;

            vFade = smoothstep(8.2, 1.8, abs(p.x)) * smoothstep(5.2, 1.4, abs(p.y));
            vTint = aTint;
            vLift = clamp(p.z * 1.6 + 0.5, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uInk;
          uniform vec3 uCopper;
          uniform float uOpacity;
          varying float vFade;
          varying float vTint;
          varying float vLift;

          void main() {
            vec3 color = mix(uInk, uCopper, vTint);
            float alpha = uOpacity * vFade * (0.30 + vLift * 0.70);
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(color, alpha);
          }
        `,
      });

      const mesh = new THREE.LineSegments(geometry, material);
      mesh.rotation.x = -0.27;
      mesh.rotation.z = -0.1;
      scene.add(mesh);

      const pointer = new THREE.Vector2(0, 0);
      const target = new THREE.Vector2(0, 0);

      const onPointerMove = (event: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        target.set(
          ((event.clientX - rect.left) / rect.width - 0.5) * 1.2,
          -((event.clientY - rect.top) / rect.height - 0.5) * 1.2,
        );
      };

      const resize = () => {
        const width = host.clientWidth || 1;
        const height = host.clientHeight || 1;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      const clock = new THREE.Clock();

      const render = () => {
        const elapsed = clock.getElapsedTime();
        pointer.lerp(target, 0.045);
        material.uniforms.uTime.value = elapsed;
        material.uniforms.uPointer.value.copy(pointer);
        renderer.render(scene, camera);
      };

      const loop = () => {
        render();
        frame = requestAnimationFrame(loop);
      };

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();
      window.addEventListener('pointermove', onPointerMove, { passive: true });

      const onVisibility = () => {
        if (document.hidden) {
          cancelAnimationFrame(frame);
        } else if (!reduceMotion) {
          frame = requestAnimationFrame(loop);
        }
      };
      document.addEventListener('visibilitychange', onVisibility);

      if (reduceMotion) {
        pointer.set(0.15, 0.1);
        render();
      } else {
        loop();
      }

      cleanup = () => {
        cancelAnimationFrame(frame);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pointermove', onPointerMove);
        resizeObserver.disconnect();
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div ref={hostRef} aria-hidden="true" className={className} />;
}
