/**
 * The selected object's mark in the AR scene (polish round M3, B2): an
 * accent ring lying flat at the object's anchor - for a pin, the surface
 * point it stands on - as in the owner's chosen HUD prototype H1.
 *
 * @see selection-mark.ts.md
 */

import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Object3D,
} from "three";

/** The ring's name, how a test finds it under a preview's group. */
export const SELECTION_MARK_NAME = "selection-mark";

/** The page's route red (`--map-route`): the accent of the setup. */
const MARK_COLOUR = 0xcf4428;
/** Inner and outer radius in metres: about a hand's width around a pin. */
const INNER_M = 0.2;
const OUTER_M = 0.26;

export interface SelectionMark {
  /** Ring the object of `root` (a preview's group), or take the ring away
   *  with null. Idempotent for the same group, so it can run on every
   *  render; a redrawn group of the same object gets it anew. */
  show(root: Object3D | null): void;
  /** Take the ring away and free its geometry and material. */
  dispose(): void;
}

export function createSelectionMark(): SelectionMark {
  const ring = new Mesh(
    new RingGeometry(INNER_M, OUTER_M, 48),
    new MeshBasicMaterial({
      color: MARK_COLOUR,
      side: DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );
  ring.name = SELECTION_MARK_NAME;
  // Flat on the surface: the ring geometry lies in XY.
  ring.rotation.x = -Math.PI / 2;
  // Drawn over the object's own surface, never hidden in it.
  ring.renderOrder = 2;
  let marked: Object3D | null = null;

  return {
    show(root) {
      if (root === marked) return;
      ring.removeFromParent();
      marked = null;
      // A preview's group holds its one object at the anchor; a group with
      // none (a photo that failed to decode) has nothing to ring.
      const object = root?.children.find((c) => c !== ring);
      if (root === null || object === undefined) return;
      ring.position.copy(object.position);
      root.add(ring);
      marked = root;
    },
    dispose() {
      ring.removeFromParent();
      marked = null;
      ring.geometry.dispose();
      ring.material.dispose();
    },
  };
}
