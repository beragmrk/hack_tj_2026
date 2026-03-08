"use client";

import { OrbitControls, Text } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { usePulseStore } from "@/stores/usePulseStore";
import { GraphEdge, GraphNode } from "@/types/pulse";

const FLOOR_Y = -1.92;
const ROOM_COLS = 4;
const ROOM_ROWS = 2;
const ROOM_X_ORIGIN = -18.3;
const ROOM_X_SPACING = 12.2;
const ROOM_Z_ORIGIN = -13.2;
const ROOM_Z_SPACING = 8.9;
const WING_Z_SPACING = 18.2;
const ROOM_WIDTH = 8.8;
const ROOM_DEPTH = 6.3;
const ROOM_WALL_HEIGHT = 1.75;
const ROOM_WALL_THICKNESS = 0.13;
const ROOM_DOOR_WIDTH = 2.35;

type GraphSceneProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  attentionRoomId: string | null;
  recoveryRoomIds: Set<string>;
  onSelectNode: (nodeId: string | null) => void;
};

type PhysioNetGraphProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
};

type RoomCell = {
  roomId: string;
  roomNumber: string;
  wingKey: "north" | "south";
  wingLabel: string;
  x: number;
  z: number;
  doorDirection: 1 | -1;
};

type RoomIndicator = {
  id: string;
  roomId: string;
  x: number;
  y: number;
  z: number;
  status: "idle" | "occupied" | "alarm" | "recovery";
  severity: GraphNode["severity"] | null;
};

function nodeBaseColor(node: GraphNode): THREE.Color {
  if (node.kind === "patient") return new THREE.Color("#2d6f90");
  if (node.kind === "device") return new THREE.Color("#4f7f97");
  if (node.kind === "signal") return new THREE.Color("#60a9bc");
  if (node.severity === "critical") return new THREE.Color("#d9342f");
  if (node.severity === "high") return new THREE.Color("#e45a2a");
  if (node.severity === "medium") return new THREE.Color("#d09a3a");
  return new THREE.Color("#8eaec0");
}

function nodeScale(node: GraphNode): number {
  if (node.kind === "patient") return 1.1;
  if (node.kind === "device") return 0.95;
  if (node.kind === "signal") return 0.88;
  if (node.kind === "alarm") return 1.12;
  return 1;
}

function parseRoomIdFromSelection(selectedNodeId: string | null, nodeMap: Map<string, GraphNode>): string | null {
  if (!selectedNodeId) return null;

  if (selectedNodeId.startsWith("room:")) {
    const parts = selectedNodeId.split(":");
    const roomToken = parts.length >= 3 ? parts[2] : "";
    return roomToken ? `ICU-${roomToken}` : null;
  }

  return nodeMap.get(selectedNodeId)?.roomId ?? null;
}

function applyNodeInstances(
  mesh: THREE.InstancedMesh | null,
  subset: GraphNode[],
  selectedNodeId: string | null
): void {
  if (!mesh) return;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  subset.forEach((node, idx) => {
    const selectedBoost = selectedNodeId === node.id ? 1.26 : 1;
    const size = nodeScale(node) * selectedBoost;

    position.set(node.x, node.y, node.z);
    scale.set(size, size, size);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(idx, matrix);

    const color = nodeBaseColor(node);
    if (selectedNodeId === node.id) {
      color.offsetHSL(0.005, 0.05, 0.12);
    }
    mesh.setColorAt(idx, color);
  });

  mesh.count = subset.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function RenderKeepAlive() {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const wake = () => invalidate();
    const interval = window.setInterval(wake, 2000);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [invalidate]);

  return null;
}

function GraphScene({ nodes, edges, selectedNodeId, attentionRoomId, recoveryRoomIds, onSelectNode }: GraphSceneProps) {
  const roomMarkerMeshRef = useRef<THREE.InstancedMesh>(null);
  const patientMeshRef = useRef<THREE.InstancedMesh>(null);
  const deviceMeshRef = useRef<THREE.InstancedMesh>(null);
  const signalMeshRef = useRef<THREE.InstancedMesh>(null);
  const alarmMeshRef = useRef<THREE.InstancedMesh>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const patientNodes = useMemo(() => nodes.filter((node) => node.kind === "patient"), [nodes]);
  const deviceNodes = useMemo(() => nodes.filter((node) => node.kind === "device"), [nodes]);
  const signalNodes = useMemo(() => nodes.filter((node) => node.kind === "signal"), [nodes]);
  const alarmNodes = useMemo(() => nodes.filter((node) => node.kind === "alarm"), [nodes]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  const roomCells = useMemo<RoomCell[]>(() => {
    const cells: RoomCell[] = [];

    for (let wing = 0; wing < 2; wing += 1) {
      for (let row = 0; row < ROOM_ROWS; row += 1) {
        for (let col = 0; col < ROOM_COLS; col += 1) {
          const wingKey = wing === 0 ? "north" : "south";
          const wingLabel = wing === 0 ? "North ICU" : "South ICU";
          const roomNumber = wing * ROOM_ROWS * ROOM_COLS + row * ROOM_COLS + col + 1;
          const roomId = `ICU-${String(roomNumber).padStart(2, "0")}`;
          const x = ROOM_X_ORIGIN + col * ROOM_X_SPACING;
          const z = ROOM_Z_ORIGIN + row * ROOM_Z_SPACING + wing * WING_Z_SPACING;
          const doorDirection = wing === 0 ? 1 : -1;

          cells.push({
            roomId,
            roomNumber: String(roomNumber).padStart(2, "0"),
            wingKey,
            wingLabel,
            x,
            z,
            doorDirection
          });
        }
      }
    }

    return cells;
  }, []);

  const patientByRoom = useMemo(() => {
    const map = new Map<string, GraphNode>();
    patientNodes.forEach((node) => {
      if (node.roomId) map.set(node.roomId, node);
    });
    return map;
  }, [patientNodes]);

  const alarmByRoom = useMemo(() => {
    const map = new Map<string, GraphNode>();
    alarmNodes.forEach((node) => {
      if (node.roomId) map.set(node.roomId, node);
    });
    return map;
  }, [alarmNodes]);

  const roomIndicators = useMemo<RoomIndicator[]>(() => {
    return roomCells.map((cell) => {
      const patient = patientByRoom.get(cell.roomId) ?? null;
      const alarm = alarmByRoom.get(cell.roomId) ?? null;
      const status: RoomIndicator["status"] = alarm
        ? "alarm"
        : recoveryRoomIds.has(cell.roomId)
          ? "recovery"
          : patient
            ? "occupied"
            : "idle";

      return {
        id: `room:${cell.wingKey}:${cell.roomNumber}`,
        roomId: cell.roomId,
        x: cell.x,
        y: FLOOR_Y + 0.26,
        z: cell.z + cell.doorDirection * (ROOM_DEPTH * 0.5 + 0.42),
        status,
        severity: alarm?.severity ?? null
      };
    });
  }, [alarmByRoom, patientByRoom, roomCells, recoveryRoomIds]);

  const selectedRoomId = useMemo(() => parseRoomIdFromSelection(selectedNodeId, nodeMap), [nodeMap, selectedNodeId]);

  const cleanEdges = useMemo(() => {
    return edges.filter((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return false;
      if (!source.roomId || !target.roomId) return false;
      return source.roomId === target.roomId;
    });
  }, [edges, nodeMap]);

  const contextLineSegments = useMemo(() => {
    if (!selectedNodeId && !selectedRoomId) {
      return new Float32Array();
    }

    const positions: number[] = [];

    cleanEdges.forEach((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return;

      const selectedEdge = selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
      const sameRoom = selectedRoomId && source.roomId === selectedRoomId && target.roomId === selectedRoomId;
      if (!selectedEdge && !sameRoom) return;

      positions.push(source.x, source.y, source.z, target.x, target.y, target.z);
    });

    return new Float32Array(positions);
  }, [cleanEdges, nodeMap, selectedNodeId, selectedRoomId]);

  useEffect(() => {
    applyNodeInstances(patientMeshRef.current, patientNodes, selectedNodeId);
    applyNodeInstances(deviceMeshRef.current, deviceNodes, selectedNodeId);
    applyNodeInstances(signalMeshRef.current, signalNodes, selectedNodeId);
    applyNodeInstances(alarmMeshRef.current, alarmNodes, selectedNodeId);
  }, [alarmNodes, deviceNodes, patientNodes, selectedNodeId, signalNodes]);

  useFrame(({ clock }) => {
    const roomMesh = roomMarkerMeshRef.current;
    if (roomMesh) {
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const color = new THREE.Color();
      const elapsed = clock.getElapsedTime();

      roomIndicators.forEach((room, idx) => {
        const selected = selectedNodeId === room.id || selectedRoomId === room.roomId;
        const alerted = attentionRoomId === room.roomId;
        const pulse =
          room.status === "recovery"
            ? 0.02 * (0.5 + 0.5 * Math.sin(elapsed * 0.7))
            : room.status === "alarm"
              ? room.severity === "critical" || room.severity === "high"
                ? 0.09 * (0.5 + 0.5 * Math.sin(elapsed * 1.7))
                : 0.05 * (0.5 + 0.5 * Math.sin(elapsed * 1.15))
              : 0;
        const size = (selected ? 1.2 : 1) * (1 + pulse);

        position.set(room.x, room.y, room.z);
        scale.set(size, size, size);
        matrix.compose(position, quaternion, scale);
        roomMesh.setMatrixAt(idx, matrix);

        if (alerted) {
          color.set("#d95f32");
        } else if (room.status === "alarm") {
          color.set(room.severity === "critical" || room.severity === "high" ? "#d9342f" : "#d98b45");
        } else if (room.status === "recovery") {
          color.set("#4a9c7d");
        } else if (room.status === "occupied") {
          color.set("#4387b4");
        } else {
          color.set("#9fb8c8");
        }

        if (pulse > 0) {
          color.offsetHSL(0, 0.02, Math.min(0.1, pulse * 0.9));
        }
        if (selected) {
          color.offsetHSL(0, 0.06, 0.1);
        }

        roomMesh.setColorAt(idx, color);
      });

      roomMesh.count = roomIndicators.length;
      roomMesh.instanceMatrix.needsUpdate = true;
      if (roomMesh.instanceColor) {
        roomMesh.instanceColor.needsUpdate = true;
      }
    }

    controlsRef.current?.update();
  });

  const onSelectFrom =
    (subset: GraphNode[]) =>
    (event: ThreeEvent<PointerEvent>): void => {
      event.stopPropagation();
      if (event.instanceId === undefined) return;
      const selected = subset[event.instanceId];
      onSelectNode(selected?.id ?? null);
    };

  const onSelectRoomMarker = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation();
    if (event.instanceId === undefined) return;
    const selected = roomIndicators[event.instanceId];
    onSelectNode(selected?.id ?? null);
  };

  const corridorNorth = roomCells.filter((cell) => cell.wingKey === "north");
  const corridorSouth = roomCells.filter((cell) => cell.wingKey === "south");

  return (
    <>
      <color attach="background" args={["#eef3f7"]} />
      <fog attach="fog" args={["#eef3f7", 34, 96]} />

      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#f6fbff", "#d8e7f1", 0.56]} />
      <directionalLight position={[18, 18, 8]} intensity={0.75} color="#d6e7f3" />
      <directionalLight position={[-14, 11, -12]} intensity={0.35} color="#f8fcff" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
        <planeGeometry args={[106, 74]} />
        <meshStandardMaterial color="#f7fafc" roughness={0.95} metalness={0.01} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.01, -0.08]}>
        <planeGeometry args={[102, 10.6]} />
        <meshStandardMaterial color="#e1eaf1" roughness={1} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.015, -0.08]}>
        <planeGeometry args={[102, 0.52]} />
        <meshStandardMaterial color="#f9fdff" roughness={0.75} metalness={0.03} />
      </mesh>

      {[-1, 1].map((side) => (
        <group key={`nurse-station-${side}`} position={[0, FLOOR_Y + 0.03, side * 4.8]}>
          <mesh>
            <boxGeometry args={[8.2, 0.08, 1.35]} />
            <meshStandardMaterial color="#dce7ef" roughness={0.82} metalness={0.04} />
          </mesh>
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[7.7, 1.02, 0.14]} />
            <meshStandardMaterial color="#c3d4df" roughness={0.72} metalness={0.08} />
          </mesh>
          <mesh position={[-2.3, 1.02, 0.02]}>
            <boxGeometry args={[1.2, 0.7, 0.06]} />
            <meshStandardMaterial color="#9db9ca" roughness={0.33} metalness={0.14} />
          </mesh>
          <mesh position={[2.3, 1.02, -0.02]}>
            <boxGeometry args={[1.2, 0.7, 0.06]} />
            <meshStandardMaterial color="#9db9ca" roughness={0.33} metalness={0.14} />
          </mesh>
        </group>
      ))}

      {corridorNorth.length > 0 && (
        <Text
          position={[0, FLOOR_Y + 0.32, corridorNorth[0].z + ROOM_DEPTH + 0.9]}
          fontSize={0.32}
          color="#577489"
          anchorX="center"
          anchorY="middle"
        >
          North ICU Hall
        </Text>
      )}
      {corridorSouth.length > 0 && (
        <Text
          position={[0, FLOOR_Y + 0.32, corridorSouth[0].z - ROOM_DEPTH - 0.9]}
          fontSize={0.32}
          color="#577489"
          anchorX="center"
          anchorY="middle"
        >
          South ICU Hall
        </Text>
      )}

      {roomCells.map((cell) => {
        const roomSelected = selectedRoomId === cell.roomId;
        const roomPatient = patientByRoom.get(cell.roomId) ?? null;
        const roomAlarm = alarmByRoom.get(cell.roomId) ?? null;
        const occupied = Boolean(roomPatient);
        const recovering = recoveryRoomIds.has(cell.roomId);
        const bedZ = -cell.doorDirection * 0.56;
        const corridorSide = cell.doorDirection * (ROOM_DEPTH * 0.5);
        const farWallSide = -cell.doorDirection * (ROOM_DEPTH * 0.5);
        const sideWallY = FLOOR_Y + ROOM_WALL_HEIGHT * 0.5;

        return (
          <group key={cell.roomId} position={[cell.x, 0, cell.z]}>
            <mesh
              position={[0, FLOOR_Y + 0.03, 0]}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectNode(`room:${cell.wingKey}:${cell.roomNumber}`);
              }}
            >
              <boxGeometry args={[ROOM_WIDTH, 0.06, ROOM_DEPTH]} />
              <meshStandardMaterial
                color={
                  roomSelected
                    ? "#d6e8f4"
                    : recovering
                      ? "#edf8f3"
                      : occupied
                        ? "#edf6fb"
                        : "#f4f8fb"
                }
                roughness={0.92}
                metalness={0.01}
              />
            </mesh>

            <mesh position={[-ROOM_WIDTH * 0.5, sideWallY, 0]}>
              <boxGeometry args={[ROOM_WALL_THICKNESS, ROOM_WALL_HEIGHT, ROOM_DEPTH]} />
              <meshStandardMaterial color="#cfdee8" roughness={0.82} metalness={0.05} />
            </mesh>
            <mesh position={[ROOM_WIDTH * 0.5, sideWallY, 0]}>
              <boxGeometry args={[ROOM_WALL_THICKNESS, ROOM_WALL_HEIGHT, ROOM_DEPTH]} />
              <meshStandardMaterial color="#cfdee8" roughness={0.82} metalness={0.05} />
            </mesh>
            <mesh position={[0, sideWallY, farWallSide]}>
              <boxGeometry args={[ROOM_WIDTH, ROOM_WALL_THICKNESS * 7, ROOM_WALL_THICKNESS]} />
              <meshStandardMaterial color="#cfdee8" roughness={0.82} metalness={0.05} />
            </mesh>

            <mesh
              position={[
                -(ROOM_DOOR_WIDTH + (ROOM_WIDTH - ROOM_DOOR_WIDTH) * 0.5) * 0.5,
                sideWallY,
                corridorSide
              ]}
            >
              <boxGeometry args={[(ROOM_WIDTH - ROOM_DOOR_WIDTH) * 0.5, ROOM_WALL_THICKNESS * 7, ROOM_WALL_THICKNESS]} />
              <meshStandardMaterial color="#cfdee8" roughness={0.82} metalness={0.05} />
            </mesh>
            <mesh
              position={[
                (ROOM_DOOR_WIDTH + (ROOM_WIDTH - ROOM_DOOR_WIDTH) * 0.5) * 0.5,
                sideWallY,
                corridorSide
              ]}
            >
              <boxGeometry args={[(ROOM_WIDTH - ROOM_DOOR_WIDTH) * 0.5, ROOM_WALL_THICKNESS * 7, ROOM_WALL_THICKNESS]} />
              <meshStandardMaterial color="#cfdee8" roughness={0.82} metalness={0.05} />
            </mesh>

            <mesh position={[0, FLOOR_Y + 1.2, farWallSide + 0.02 * cell.doorDirection]}>
              <boxGeometry args={[2.4, 0.75, 0.03]} />
              <meshStandardMaterial color="#bcd4e3" roughness={0.4} metalness={0.08} opacity={0.7} transparent />
            </mesh>

            <mesh position={[0, FLOOR_Y + 0.12, bedZ]}>
              <boxGeometry args={[2.45, 0.12, 1.2]} />
              <meshStandardMaterial color="#d0dee8" roughness={0.7} metalness={0.04} />
            </mesh>
            <mesh position={[0, FLOOR_Y + 0.21, bedZ]}>
              <boxGeometry args={[2.2, 0.14, 1.0]} />
              <meshStandardMaterial color="#f7fbfe" roughness={0.92} metalness={0.01} />
            </mesh>
            <mesh position={[0, FLOOR_Y + 0.28, bedZ + 0.34 * cell.doorDirection]}>
              <boxGeometry args={[0.58, 0.08, 0.24]} />
              <meshStandardMaterial color="#eef6fb" roughness={0.95} metalness={0.01} />
            </mesh>
            <mesh position={[0, FLOOR_Y + 0.45, bedZ - 0.48 * cell.doorDirection]}>
              <boxGeometry args={[2.45, 0.56, 0.14]} />
              <meshStandardMaterial color="#bdd5e5" roughness={0.74} metalness={0.05} />
            </mesh>

            <mesh position={[2.55, FLOOR_Y + 0.68, bedZ - 0.1 * cell.doorDirection]}>
              <boxGeometry args={[0.86, 0.82, 0.5]} />
              <meshStandardMaterial color="#c8dbe7" roughness={0.74} metalness={0.05} />
            </mesh>
            <mesh position={[2.55, FLOOR_Y + 1.16, bedZ - 0.1 * cell.doorDirection]}>
              <boxGeometry args={[0.78, 0.5, 0.06]} />
              <meshStandardMaterial color="#90b2c6" roughness={0.33} metalness={0.18} />
            </mesh>

            <mesh position={[-2.85, FLOOR_Y + 0.62, farWallSide * 0.55]}>
              <boxGeometry args={[0.9, 0.92, 0.52]} />
              <meshStandardMaterial color="#d5e4ee" roughness={0.8} metalness={0.04} />
            </mesh>

            <mesh position={[2.5, FLOOR_Y + 0.82, bedZ - 0.16 * cell.doorDirection]}>
              <boxGeometry args={[0.12, 1.2, 0.12]} />
              <meshStandardMaterial color="#8aa6b7" roughness={0.6} metalness={0.28} />
            </mesh>
            <mesh position={[2.5, FLOOR_Y + 1.44, bedZ - 0.16 * cell.doorDirection]}>
              <boxGeometry args={[0.78, 0.5, 0.05]} />
              <meshStandardMaterial color="#a8c2d2" roughness={0.36} metalness={0.2} />
            </mesh>

            <mesh position={[0, FLOOR_Y + 1.68, 0]}>
              <boxGeometry args={[2.2, 0.04, 1.1]} />
              <meshStandardMaterial color="#fbfeff" roughness={0.2} metalness={0.02} emissive="#cfe7f5" emissiveIntensity={0.07} />
            </mesh>

            {(roomSelected || attentionRoomId === cell.roomId) && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.06, 0]}>
                <ringGeometry args={[2.85, 3.22, 44]} />
                <meshBasicMaterial
                  color={
                    attentionRoomId === cell.roomId
                      ? "#db6438"
                      : roomAlarm?.severity === "critical" || roomAlarm?.severity === "high"
                        ? "#d45b3f"
                        : "#4f8aae"
                  }
                  transparent
                  opacity={attentionRoomId === cell.roomId ? 0.9 : 0.75}
                  toneMapped={false}
                />
              </mesh>
            )}

            <Text
              position={[0, FLOOR_Y + 2.15, farWallSide - 0.06 * cell.doorDirection]}
              fontSize={0.34}
              color={roomSelected ? "#275a7a" : roomAlarm ? "#8d2d20" : "#4d6f84"}
              anchorX="center"
              anchorY="middle"
            >
              {cell.roomId}
            </Text>
            <Text
              position={[0, FLOOR_Y + 1.77, farWallSide - 0.06 * cell.doorDirection]}
              fontSize={0.2}
              color="#7393a7"
              anchorX="center"
              anchorY="middle"
            >
              {roomAlarm ? "Alarm Active" : recovering ? "Under Observation" : occupied ? "Occupied" : "Idle"}
            </Text>
          </group>
        );
      })}

      <instancedMesh
        ref={roomMarkerMeshRef}
        args={[undefined, undefined, Math.max(roomIndicators.length, 1)]}
        onPointerDown={onSelectRoomMarker}
      >
        <sphereGeometry args={[0.2, 14, 14]} />
        <meshStandardMaterial
          vertexColors
          roughness={0.22}
          metalness={0.16}
          emissive="#5f98b8"
          emissiveIntensity={0.14}
        />
      </instancedMesh>

      <instancedMesh
        ref={patientMeshRef}
        args={[undefined, undefined, Math.max(patientNodes.length, 1)]}
        onPointerDown={onSelectFrom(patientNodes)}
      >
        <sphereGeometry args={[0.32, 18, 18]} />
        <meshStandardMaterial vertexColors roughness={0.32} metalness={0.15} emissive="#7eb5cf" emissiveIntensity={0.06} />
      </instancedMesh>

      <instancedMesh
        ref={deviceMeshRef}
        args={[undefined, undefined, Math.max(deviceNodes.length, 1)]}
        onPointerDown={onSelectFrom(deviceNodes)}
      >
        <boxGeometry args={[0.34, 0.34, 0.34]} />
        <meshStandardMaterial vertexColors roughness={0.3} metalness={0.22} emissive="#7ba1b8" emissiveIntensity={0.05} />
      </instancedMesh>

      <instancedMesh
        ref={signalMeshRef}
        args={[undefined, undefined, Math.max(signalNodes.length, 1)]}
        onPointerDown={onSelectFrom(signalNodes)}
      >
        <octahedronGeometry args={[0.24, 0]} />
        <meshStandardMaterial vertexColors roughness={0.35} metalness={0.16} emissive="#77c2cf" emissiveIntensity={0.06} />
      </instancedMesh>

      <instancedMesh
        ref={alarmMeshRef}
        args={[undefined, undefined, Math.max(alarmNodes.length, 1)]}
        onPointerDown={onSelectFrom(alarmNodes)}
      >
        <coneGeometry args={[0.24, 0.56, 16]} />
        <meshStandardMaterial vertexColors roughness={0.32} metalness={0.08} emissive="#d97a59" emissiveIntensity={0.13} />
      </instancedMesh>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[contextLineSegments, 3]}
            count={contextLineSegments.length / 3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#4f86a4" transparent opacity={0.9} />
      </lineSegments>

      <RenderKeepAlive />
      <OrbitControls
        ref={controlsRef}
        enablePan
        enableDamping
        dampingFactor={0.075}
        minDistance={16}
        maxDistance={44}
        minPolarAngle={0.42}
        maxPolarAngle={1.24}
        target={[0, FLOOR_Y + 0.34, 0]}
        autoRotate={false}
      />
    </>
  );
}

export function PhysioNetGraph({ nodes, edges, selectedNodeId, onSelectNode }: PhysioNetGraphProps) {
  const attentionRoomId = usePulseStore((s) => s.attentionEvent?.roomId ?? null);
  const roomRecovery = usePulseStore((s) => s.roomRecovery);
  const recoveryRoomIds = useMemo(() => {
    const now = Date.now();
    const ids = Object.entries(roomRecovery)
      .filter(([, state]) => now - state.clearedAt < 180_000)
      .map(([roomId]) => roomId);
    return new Set(ids);
  }, [roomRecovery]);

  return (
    <div className="relative h-[430px] w-full overflow-hidden rounded-2xl border border-[#96b5c8]/70 bg-[#eef4f8] shadow-[0_14px_30px_rgba(57,98,126,0.16)] xl:h-[445px]">
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-[#abc3d2]/80 bg-white/92 px-3 py-1.5 text-[11px] tracking-[0.02em] text-slate-600 shadow-sm">
        4x4 ICU Room Map | Select A Room, Patient, Device, Or Alarm For Details
      </div>
      <Canvas
        frameloop="always"
        camera={{ position: [14, 14.8, 36], fov: 41 }}
        onPointerMissed={() => onSelectNode(null)}
      >
        <GraphScene
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          attentionRoomId={attentionRoomId}
          recoveryRoomIds={recoveryRoomIds}
          onSelectNode={onSelectNode}
        />
      </Canvas>
    </div>
  );
}
