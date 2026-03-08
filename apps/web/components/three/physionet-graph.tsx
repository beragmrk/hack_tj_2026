"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { GraphEdge, GraphNode } from "@/types/pulse";

const NODE_RADIUS = 0.32;

function nodeColor(node: GraphNode): THREE.Color {
  if (node.kind === "patient") return new THREE.Color("#7af0d0");
  if (node.kind === "device") return new THREE.Color("#8cd5ff");
  if (node.kind === "signal") return new THREE.Color("#f2df83");
  if (node.severity === "critical") return new THREE.Color("#ff4c4c");
  if (node.severity === "high") return new THREE.Color("#ff8e56");
  return new THREE.Color("#f7b267");
}

type GraphSceneProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

function GraphScene({ nodes, edges }: GraphSceneProps) {
  const nodeMeshRef = useRef<THREE.InstancedMesh>(null);
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  const lineSegments = useMemo(() => {
    const positions: number[] = [];
    edges.forEach((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return;

      positions.push(source.x, source.y, source.z, target.x, target.y, target.z);
    });

    return new Float32Array(positions);
  }, [edges, nodeMap]);

  useEffect(() => {
    const mesh = nodeMeshRef.current;
    if (!mesh) return;

    const matrix = new THREE.Matrix4();
    nodes.forEach((node, idx) => {
      matrix.makeTranslation(node.x, node.y, node.z);
      mesh.setMatrixAt(idx, matrix);
      mesh.setColorAt(idx, nodeColor(node));
    });

    mesh.count = nodes.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [nodes]);

  useFrame(({ clock }) => {
    const mesh = particleMeshRef.current;
    if (!mesh || edges.length === 0) return;

    const matrix = new THREE.Matrix4();
    const now = clock.getElapsedTime();
    let particleIndex = 0;

    edges.forEach((edge, edgeIndex) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return;

      const particleCount = Math.min(8, Math.max(2, Math.floor(edge.throughput / 2)));
      for (let i = 0; i < particleCount; i += 1) {
        const phase = (now * 0.35 + i / particleCount + edgeIndex * 0.09) % 1;
        const x = source.x + (target.x - source.x) * phase;
        const y = source.y + (target.y - source.y) * phase;
        const z = source.z + (target.z - source.z) * phase;

        matrix.makeTranslation(x, y, z);
        mesh.setMatrixAt(particleIndex, matrix);
        mesh.setColorAt(particleIndex, new THREE.Color("#8cf2ff"));
        particleIndex += 1;

        if (particleIndex >= mesh.count) {
          break;
        }
      }
    });

    mesh.count = particleIndex;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  const particleCapacity = Math.max(24, edges.length * 8);

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[6, 10, 8]} intensity={2.2} color="#95f2dd" />
      <pointLight position={[-8, -4, -6]} intensity={1.4} color="#f7b267" />

      <instancedMesh ref={nodeMeshRef} args={[undefined, undefined, Math.max(nodes.length, 1)]}>
        <sphereGeometry args={[NODE_RADIUS, 16, 16]} />
        <meshStandardMaterial roughness={0.2} metalness={0.1} vertexColors />
      </instancedMesh>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[lineSegments, 3]}
            count={lineSegments.length / 3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#7dd8d0" transparent opacity={0.35} />
      </lineSegments>

      <instancedMesh ref={particleMeshRef} args={[undefined, undefined, particleCapacity]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial vertexColors transparent opacity={0.9} />
      </instancedMesh>

      <OrbitControls
        enablePan={false}
        minDistance={12}
        maxDistance={45}
        autoRotate
        autoRotateSpeed={0.28}
      />
    </>
  );
}

export function PhysioNetGraph({ nodes, edges }: GraphSceneProps) {
  return (
    <div className="h-[490px] w-full rounded-xl border border-primary/20 bg-[#071218]/70 shadow-glow">
      <Canvas camera={{ position: [0, 0, 22], fov: 50 }}>
        <GraphScene nodes={nodes} edges={edges} />
      </Canvas>
    </div>
  );
}
