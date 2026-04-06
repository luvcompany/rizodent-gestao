import { useCallback } from "react";
import type { Node, Edge } from "@xyflow/react";

const SNAP_THRESHOLD = 8;

export type SnapLine = {
  type: "horizontal" | "vertical";
  position: number;
};

export function useSnapLines() {
  const getSnapLines = useCallback(
    (draggingNode: Node, allNodes: Node[]): { snapLines: SnapLine[]; snappedPosition: { x: number; y: number } } => {
      const snapLines: SnapLine[] = [];
      let snappedX = draggingNode.position.x;
      let snappedY = draggingNode.position.y;
      const dragW = draggingNode.measured?.width ?? 250;
      const dragH = draggingNode.measured?.height ?? 80;

      const dragCenterX = draggingNode.position.x + dragW / 2;
      const dragCenterY = draggingNode.position.y + dragH / 2;

      let closestDx = SNAP_THRESHOLD + 1;
      let closestDy = SNAP_THRESHOLD + 1;

      for (const node of allNodes) {
        if (node.id === draggingNode.id) continue;
        const w = node.measured?.width ?? 250;
        const h = node.measured?.height ?? 80;
        const cx = node.position.x + w / 2;
        const cy = node.position.y + h / 2;

        // Vertical alignment (X axis)
        const checks_x = [
          { drag: draggingNode.position.x, target: node.position.x }, // left-left
          { drag: dragCenterX, target: cx }, // center-center
          { drag: draggingNode.position.x + dragW, target: node.position.x + w }, // right-right
        ];
        for (const c of checks_x) {
          const d = Math.abs(c.drag - c.target);
          if (d < SNAP_THRESHOLD && d < closestDx) {
            closestDx = d;
            snappedX = draggingNode.position.x + (c.target - c.drag);
            snapLines.push({ type: "vertical", position: c.target });
          }
        }

        // Horizontal alignment (Y axis)
        const checks_y = [
          { drag: draggingNode.position.y, target: node.position.y }, // top-top
          { drag: dragCenterY, target: cy }, // center-center
          { drag: draggingNode.position.y + dragH, target: node.position.y + h }, // bottom-bottom
        ];
        for (const c of checks_y) {
          const d = Math.abs(c.drag - c.target);
          if (d < SNAP_THRESHOLD && d < closestDy) {
            closestDy = d;
            snappedY = draggingNode.position.y + (c.target - c.drag);
            snapLines.push({ type: "horizontal", position: c.target });
          }
        }
      }

      return {
        snapLines: closestDx <= SNAP_THRESHOLD || closestDy <= SNAP_THRESHOLD ? snapLines : [],
        snappedPosition: { x: snappedX, y: snappedY },
      };
    },
    []
  );

  return { getSnapLines };
}

export function duplicateNode(node: Node): Node {
  const { onDuplicate, onDeleteNode, ...cleanData } = node.data as any;
  return {
    id: `${node.type}-${Date.now()}`,
    type: node.type!,
    position: { x: node.position.x + 50, y: node.position.y + 50 },
    data: JSON.parse(JSON.stringify(cleanData)),
  };
}
