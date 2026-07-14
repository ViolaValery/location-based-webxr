## Plan: Commands Component

This component owns the edit/undo/redo layer for KmlEditor. It is not a UI layer, not a persistence layer, and not a model layer; it is the deterministic command engine that mutates the active KML document through the shared contracts and records enough state to reverse those mutations exactly.

The key architectural decision is that the command stack is document-scoped. Because `ICommandStack.execute(command)` does not accept a document or bridge, the concrete stack must be created with the active `IKmlDocument` and `IGeoBridge` already bound into it. When the editor loads a new file, it must discard the old stack and create a new one instead of trying to reset history in place. That keeps the contract unchanged and avoids hidden coupling.

**Overview**
- What it owns: immutable command objects, the undo/redo stack, stack listeners, and the exact mutation/reversal logic for the supported edit operations.
- What it never owns: file I/O, KMZ parsing, XML serialization, rendering, selection state, persistence, or gesture interpretation.
- Contracts it consumes: `IKmlDocument`, `IFeatureView` and the typed feature interfaces, `FeatureTemplate`, `FeatureSnapshot`, `GeoPosition`, `WorldPosition`, `LatLonBox`, `ModelOrientation`, `ModelScale`, `AltitudeMode`, and `IGeoBridge`.
- Contracts it implements: `ICommand` and `ICommandStack` exactly as defined in `src/contracts/commands.ts`.
- Explicit boundary: selection and pointer handling stay in `editor` or `ar-scene`; commands only receive already-decided targets such as feature ids, vertex indices, and final world-space or geo-space values.

**Internal Architecture**
- `src/commands/stack.ts` owns the concrete `ICommandStack` implementation. It stores a history array, a cursor, the bound `IKmlDocument`, the bound `IGeoBridge`, and a listener set. Inputs are command objects and stack lifecycle events. Outputs are synchronous state transitions and change notifications. Invariant: the redo tail is truncated on any new execute, and undo/redo are linear moves over the same command sequence.
- `src/commands/text.ts` owns name and description commands. Inputs are a feature id and the final text value. Outputs are in-place updates of `name` and `description` on the matching feature view. Invariant: these commands never touch any geometric field.
- `src/commands/spatial.ts` owns all geometry-changing commands for markers, lines, overlays, and models. Inputs are a feature id, a concrete target transform or coordinate payload, and the document/bridge bindings supplied by the stack. Outputs are typed feature mutations only through the public feature-view setters and fields. Invariant: undo restores the exact original values captured on first execution; redo reapplies the stored target payload without recomputing from a changed document state.
- `src/commands/structural.ts` owns create/delete commands. Inputs are `FeatureTemplate`, feature ids, optional insertion anchors, and delete snapshots. Outputs are calls to `insertFeature`, `removeFeature`, and `restoreFeature`. Invariant: the command never parses or rewrites XML itself; the document model owns all structural KML mutation.
- `src/commands/guards.ts` or an equivalent shared helper module owns type checks and precondition validation. Inputs are feature ids and expected feature types. Outputs are typed feature views or explicit failure. Invariant: every command validates its target immediately before mutation so a stale id cannot corrupt the document.
- `src/commands/index.ts` is the public entrypoint. It exports the concrete stack factory and the concrete command factories so the rest of the app never needs to know the internal file layout.

This decomposition minimizes coupling because the stack only knows about generic command objects, the command families only know about the contracts, and the shared helpers only know how to validate and locate features. No command reaches into another component’s internals, and no command stores scene-graph or file-system state.

**Runtime Data Flow**
- Loading: the store loads a document, creates a new `IKmlDocument`, creates a new `IGeoBridge` or resets its anchor, and then creates a fresh command stack bound to those objects. The stack starts empty. No command is replayed during loading.
- Editing: the UI or replay test constructs an `ICommand` with the final target value, then calls `execute` on the stack. The stack calls `command.execute(document, geoBridge)`, appends the command only after a successful mutation, advances the cursor, and notifies listeners.
- Spatial edits: a drag or gizmo move is converted by the caller into a final target world position, target geo position, final scale, final rotation, or final vertex index. The command converts world to geo only when needed, using the bound bridge, and then writes the typed fields back to the feature view.
- Selection: selection is external. The command layer only receives the selected feature id or ids as construction input. It never stores the current selection and it never decides what should be selected next.
- Undo: `undo()` moves backward one command, calls the command’s undo method against the same bound document and bridge, and then moves the cursor back only if the undo succeeds. If there is no command to undo, it returns `null` and leaves state unchanged.
- Redo: `redo()` re-executes the next command in the history array against the same bound document and bridge, advances the cursor only after success, and returns the command. If there is no redo entry, it returns `null` and leaves state unchanged.
- Structural editing: create commands call `insertFeature` with a captured template and insertion anchor. Delete commands call `removeFeature` and store the returned snapshot. Undo of delete passes the snapshot back to `restoreFeature`. The document model remains the source of truth for exact XML placement.
- Resource disposal: the stack exposes no explicit dispose contract, so lifetime is handled by ownership. The store or editor drops the old stack when the document is closed, and listeners are removed by the unsubscribe function returned from `onChange`.
- Error handling: a failed command must not partially update the stack. If mutation throws, the cursor and history remain unchanged and the caller can surface the failure.

**Public Surface**
- `createCommandStack(document: IKmlDocument, geoBridge: IGeoBridge): ICommandStack` is the only way to construct the concrete stack. It binds the active document and bridge at creation time so the contract can remain unchanged.
- Concrete command factories or constructors are exported for each command type. The exact factory names should follow the command type names already present in the contract: move marker, move line vertex, add line vertex, remove line vertex, move overlay, scale overlay, rotate overlay, move model, scale model, rotate model, set name, set description, create feature, delete feature.
- Concrete command instances implement `ICommand` directly. They are immutable from the outside, but several of them keep private cached state such as the original values needed for undo.
- No additional cross-component API is introduced. The public surface exists only to instantiate the contract implementations and is intentionally minimal.

**Algorithms**
- History management: the stack uses a single array plus a cursor. Execute appends at the cursor and truncates any redo tail. Undo decrements the cursor after successful reversal. Redo increments the cursor after successful reapplication. Complexity is O(1) for stack operations, not counting the document mutation work inside the command.
- Precondition validation: every command resolves the target feature by id immediately before mutation and verifies the feature type matches the command family. A stale id or wrong type fails before any write happens. This avoids silently mutating the wrong feature after a reload or delete.
- Marker move: the command stores the original position the first time it executes, converts the caller-provided target world position back to geo through `IGeoBridge.worldToGeo`, and writes the resulting geo position into the marker’s `position` field. Undo restores the cached original position directly. Complexity is O(1).
- Line vertex move: the command copies the original coordinate array once, replaces exactly one vertex at the captured index with the geo position computed from the target world position, and writes the entire updated coordinate array back. Undo restores the cached original array. Complexity is O(n) for the affected line length because the array must be cloned for safe undo.
- Line vertex add/remove: add inserts a new coordinate at the captured zero-based index; remove deletes exactly one coordinate at the captured index. Both commands store the full original coordinate array for undo. Complexity is O(n) for the line length because the coordinate array is preserved losslessly.
- Overlay move/scale/rotate: the command family treats the UI as having already decided the final transform. Move updates the overlay’s geographic center or equivalent box position while preserving size and rotation. Scale writes a new `LatLonBox` with the requested extents. Rotate writes only the final `rotation` value. Undo restores the full original `LatLonBox`, altitude, and altitudeMode values as needed. The command does not attempt to derive a different interpretation of the gesture; it applies the exact target payload it was given.
- Model move/scale/rotate: move writes the final `location` only, scale writes the final `ModelScale`, and rotate writes the final `ModelOrientation`. Undo restores the full original typed values. Because model transforms are already explicit in the contract, no extra geometry is invented in the command layer.
- Name/description edits: the command caches the original string and writes the new string directly. Undo restores the exact original string. These commands must not touch coordinate data, style data, or unrelated feature properties.
- Create feature: the command stores the template and optional insertion anchor. On first execute, it inserts the feature through `IKmlDocument.insertFeature`, captures the returned id, and exposes that id through its `featureId` accessor. On redo after an undo, it reinserts the same template again and refreshes the cached id because the document model owns id generation. That is a deliberate assumption forced by the current contract surface.
- Delete feature: the command stores the feature id, calls `removeFeature`, and caches the returned `FeatureSnapshot`. Undo passes the same snapshot to `restoreFeature`. Redo deletes the same feature again by id. The command never parses the snapshot fragment itself.
- Command replay: replay is deterministic because each command stores the exact target payload and the exact original state it observed on first execution. The command stack never recomputes the user’s intent from current scene state during undo/redo.
- Numerical precision: spatial commands do not round or stringify numbers themselves. They pass doubles through to the geo bridge or feature view and let the KML model preserve formatting. That prevents the command layer from introducing extra numeric drift or duplicate rounding.

**State Management**
- Stack history is owned by the concrete command stack. It consists of a command array, a cursor, and the bound document/bridge references. Lifetime matches the loaded document. When a new file is loaded, the old stack is dropped rather than cleared.
- Command-local caches are owned by each command instance. Examples are the original marker position, the original coordinate array for a line, the original `LatLonBox`, and the `FeatureSnapshot` for deletes. Lifetime begins on first execute and lasts until the command is discarded with the history entry.
- Listeners are owned by the stack. `onChange` registers a callback and returns a disposer that removes only that callback. The listener set is not shared with any other component.
- Invalidated state is never reused across documents. Feature ids, vertex indices, and insertion anchors are considered document-specific and must be revalidated on every execute/undo.
- There is no command cache across sessions. Command objects are not persisted and are not meant to survive a page reload.

**Error Strategy**
- Missing feature id: fail the command before mutating anything. The stack does not advance and the caller receives the error.
- Wrong feature type: fail early with a typed precondition failure rather than coercing or silently skipping the command.
- Stale vertex index or out-of-range line mutation: fail before mutation. The command does not auto-clamp because silent correction would corrupt author intent.
- Geo bridge not initialized or invalid coordinate input: surface the bridge failure unchanged. The command does not invent a fallback projection because that would break determinism.
- Create-feature insertion conflict: if the document model rejects the insertion anchor or template, the command fails and the stack remains unchanged. The caller may retry with a different anchor, but the command layer does not guess.
- Delete-feature undo conflict: if `restoreFeature` cannot reinsert the snapshot because the document model detects corruption, the command fails and the stack cursor stays where it was before the undo attempt.
- Undo or redo at the boundary: return `null` and do nothing. This is the only non-exceptional no-op path.
- Listener failure: stack state stays intact. Notification happens after the mutation is committed, so a UI listener can recover by rereading the current store state.

**Performance Strategy**
- History operations are O(1) except for the document work performed by the command.
- The command layer never serializes the whole document and never clones the full XML string.
- Only touched geometry is copied. Marker and text commands store tiny amounts of state. Line commands copy the affected coordinate array once because undo correctness matters more than minimizing a few kilobytes of history data.
- Delete commands store the snapshot returned by the document model instead of re-parsing or re-serializing XML in the command layer.
- Create commands keep the original template plus the latest inserted id, not a full document snapshot.
- Listener dispatch is small and synchronous. No debounce belongs here; debouncing is a persistence concern, not a command concern.
- The stack does not impose a fixed history cap in this component. If the app later wants bounded history, that belongs in a higher-level policy decision, not in the command contract.

**Testing Strategy**
- Unit tests for the stack: execute pushes commands, undo and redo move the cursor correctly, redo is truncated after a new execute, and `onChange` subscriptions can be removed cleanly.
- Unit tests for each text command: name and description changes update only the intended field and undo restores the original string byte-for-byte through the document model.
- Unit tests for each spatial command family: marker move, line vertex move/add/remove, overlay move/scale/rotate, and model move/scale/rotate all mutate only the intended typed fields and restore the original values on undo.
- Integration tests with the real `IKmlDocument` and `IGeoBridge` implementations: a command sequence on a real fixture produces the expected typed feature state and the expected serialized diff, without touching unrelated XML.
- Replay tests with recorded movement sequences: feed captured desktop/Task-1 position samples into command construction and verify the same final document state is produced every run, with no phone input required.
- Regression tests for create/delete: create followed by delete leaves the document identical to the original; delete followed by undo restores the same feature fragment and the same surrounding XML; multiple undo/redo cycles remain stable.
- Failure tests: invalid ids, wrong feature types, out-of-range vertex indices, missing bridge anchor, and rejected structural inserts all fail without advancing stack state.
- Golden tests: compare the serialized output of a scripted command sequence against a known-good KML fixture diff so the command layer cannot introduce unwanted XML churn.

**Demo**
- The standalone demo should live in `demos/commands-demo/index.html` and should run without the rest of the editor.
- It should load a small fixture KML into the real document model, bind a command stack to a real geo bridge, and show a simple feature list with current ids, names, and types.
- The user should be able to trigger at least one command from each family: move a marker, move a line vertex, rename a feature, move or rotate a model, create a new marker, and delete an existing feature.
- The demo should show a live command log and an undo/redo control so the operator can verify the exact sequence of mutations.
- What proves it works: the displayed feature state, the serialized KML diff, and the ability to undo and redo every command without losing unrelated data.

**Dependencies**
- No new runtime library is required for the component itself.
- The component depends on the shared contracts in `src/contracts/*` and on the concrete `kml-model` and `geo-bridge` implementations that were already delivered earlier in the project order.
- Tests rely on Vitest, which is already present in the workspace.
- The demo can use the existing Three.js dependency already present in the repo if a tiny scene is needed, but the command component itself should not take a direct runtime dependency on rendering.

**Risks**
- Create-feature id stability is the highest risk because `IKmlDocument.insertFeature()` generates ids. Detection: redo a create command multiple times and verify the command still points at the latest inserted id. Mitigation: keep the current inserted id inside the command instance and refresh it on each execute. Fallback: if the document model later gains explicit id insertion support, the command can adopt it without changing the contract.
- Spatial drift is a risk if commands recompute intent from the current document instead of using cached original state and final target values. Detection: repeated undo/redo of a move should produce identical serialized output each cycle. Mitigation: cache the original state on first execute and reapply the stored target directly on redo.
- Stale feature references are a risk when commands outlive a reload or external mutation. Detection: execute commands against replaced documents in tests. Mitigation: treat ids and indices as document-scoped and fail fast when validation fails.
- Large line edits can retain more memory than text commands. Detection: test long `LineString` histories. Mitigation: clone only the affected coordinate arrays and do not snapshot the whole document.
- Listener reentrancy can create confusing UI updates. Detection: attach listeners that mutate local state during notifications. Mitigation: keep notifications synchronous and tied only to committed stack changes.

**Milestones**
1. Build the stack skeleton with bound document and bridge, cursor management, and listener notifications. This is independently testable with no feature commands at all.
2. Implement text commands and the simplest spatial command, marker move. This proves the execute/undo pattern on real document views.
3. Implement line editing and model/overlay transforms, including the original-state caches needed for correct undo.
4. Implement create/delete commands and prove that document snapshots and reinsertion behave correctly across undo/redo.
5. Add integration and replay tests against real fixtures, then finish the standalone commands demo with visible diffs and command logs.
6. Freeze the public surface, document the stack lifecycle assumption, and hand the component off to the editor layer.
