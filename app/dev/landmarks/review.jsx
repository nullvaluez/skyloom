"use client";
import { useEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { MONUMENT_MANIFEST } from "@/lib/fly/monument-models";
import { loadOne, loadMonumentDetail } from "@/lib/fly/monument-loader";
import {
  attachCinematicModelAttributes,
  createCinematicModelMaterial,
  updateCinematicModelNight,
} from "@/lib/fly/cinematic-models";
import { buildLandmarkGeometries } from "@/lib/fly/landmarks-3d";
import { MeshToonMaterial } from "three";
function Model({ entry, style, day, baseline }) {
  const { camera } = useThree();
  const [geometry, setGeometry] = useState(null),
    [material] = useState(() =>
      style === "sat"
        ? createCinematicModelMaterial(() => {}, { merged: true })
        : new MeshToonMaterial({ vertexColors: true }),
    );
  useEffect(() => {
    let live = true,
      g;
    const originalArchetype =
      baseline && ["CN Tower", "Burj Khalifa"].includes(entry.poi);
    const run = originalArchetype
      ? Promise.resolve().then(() => {
          const all = buildLandmarkGeometries(style);
          for (const [k, g] of Object.entries(all))
            if (k !== "spire") g.dispose();
          return all.spire;
        })
      : entry.detail?.high && !baseline
        ? loadMonumentDetail(entry, "high", style)
        : loadOne(entry, style);
    run
      .then((geo) => {
        g = geo;
        if (!live) {
          g.dispose();
          return;
        }
        if (style === "sat")
          attachCinematicModelAttributes(g, { ...entry, ...(!baseline ? entry.detail?.high : {}), baseline });
        g.deleteAttribute("_model_surface");
        g.deleteAttribute("_model_light");
        g.computeBoundingBox();
        const b = g.boundingBox;
        const span = Math.max(1, b.max.x - b.min.x, b.max.z - b.min.z);
        camera.position.set(span, 0.35 * span, 1.8 * span);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        setGeometry(g);
        window.__landmarkArt = {
          ready: true,
          poi: entry.poi,
          triangles: g.index.count / 3,
          baseline,
          style,
        };
      })
      .catch((e) => {
        window.__landmarkArt = { error: e.message };
      });
    return () => {
      live = false;
      g?.dispose();
      material.dispose();
    };
  }, [entry, style, baseline, material, camera]);
  updateCinematicModelNight(material, day);
  return geometry ? (
    <mesh geometry={geometry} material={material} position={[0, -0.5, 0]} />
  ) : null;
}
export default function LandmarkReview({ query }) {
  const params = new URLSearchParams(query);
  const entry =
      MONUMENT_MANIFEST.find((e) => e.poi === params.get("name")) ??
      MONUMENT_MANIFEST[2],
    style = params.get("style") ?? "sat",
    time = params.get("time") ?? "day",
    day = time === "night" ? 0 : time === "dusk" ? 0.1 : 1,
    baseline = params.has("baseline");
  return (
    <main style={{ height: "100dvh", background: "#08101a" }}>
      <Canvas
        camera={{ position: [1, 0.35, 1.8], fov: 36 }}
        dpr={1}
        onCreated={({ gl }) => {
          const ext = gl.getContext().getExtension("WEBGL_debug_renderer_info");
          window.__artRenderer =
            ext && gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL);
        }}
      >
        <color attach="background" args={[day === 1 ? "#a7b4bb" : "#08101a"]} />
        <ambientLight intensity={day === 1 ? 1.4 : 0.18} />
        <directionalLight
          position={[3, 4, 2]}
          intensity={day === 1 ? 3 : day > 0 ? 1 : 0.15}
          color={day === 1 ? "#fff2dc" : "#b9ccff"}
        />
        <Model entry={entry} style={style} day={day} baseline={baseline} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.503, 0]}>
          <planeGeometry args={[6, 6]} />
          <meshStandardMaterial
            color={day === 1 ? "#89969a" : "#101924"}
            roughness={1}
          />
        </mesh>
        <OrbitControls target={[0, 0, 0]} enableDamping={false} />
      </Canvas>
      <div
        style={{
          position: "absolute",
          left: 20,
          top: 16,
          color: day === 1 ? "#112333" : "#d8e4ef",
          font: "13px system-ui",
        }}
      >
        {entry.poi} · {style} · {time} ·{" "}
        {baseline ? "current distant model" : "upgraded"}
        <br />
        <small>
          Isolated asset review · not world/performance certification
        </small>
      </div>
    </main>
  );
}
