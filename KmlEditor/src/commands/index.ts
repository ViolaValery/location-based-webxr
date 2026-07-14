import { ICommand, ICommandStack, CommandType } from '../contracts/commands';
import { IFeatureView, IGroundOverlayFeature, ILineFeature, IMarkerFeature, IModelFeature, IKmlDocument, FeatureType } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { AltitudeMode, FeatureId, FeatureSnapshot, FeatureTemplate, GeoPosition, LatLonBox, ModelOrientation, ModelScale, WorldPosition } from '../contracts/type';

type Listener = () => void;

type FeatureOfType<T extends FeatureType> = Extract<IFeatureView, { type: T }>;

function cloneGeoPosition(position: GeoPosition): GeoPosition {
    return { lon: position.lon, lat: position.lat, alt: position.alt };
}

function cloneWorldPosition(position: WorldPosition): WorldPosition {
    return { x: position.x, y: position.y, z: position.z };
}

function cloneLatLonBox(box: LatLonBox): LatLonBox {
    return {
        north: box.north,
        south: box.south,
        east: box.east,
        west: box.west,
        rotation: box.rotation,
    };
}

function cloneModelOrientation(orientation: ModelOrientation): ModelOrientation {
    return { heading: orientation.heading, tilt: orientation.tilt, roll: orientation.roll };
}

function cloneModelScale(scale: ModelScale): ModelScale {
    return { x: scale.x, y: scale.y, z: scale.z };
}

function isFiniteNumber(value: number): boolean {
    return Number.isFinite(value);
}

function validateWorldPosition(position: WorldPosition): void {
    if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y) || !isFiniteNumber(position.z)) {
        throw new Error('World position must contain only finite numbers');
    }
}

function validateFinitePosition(position: GeoPosition, context: string): void {
    if (!isFiniteNumber(position.lon) || !isFiniteNumber(position.lat) || !isFiniteNumber(position.alt)) {
        throw new Error(`${context} must contain only finite numbers`);
    }
}

function validateFiniteLatLonBox(box: LatLonBox): void {
    if (!isFiniteNumber(box.north) || !isFiniteNumber(box.south) || !isFiniteNumber(box.east) || !isFiniteNumber(box.west) || !isFiniteNumber(box.rotation)) {
        throw new Error('LatLonBox must contain only finite numbers');
    }
}

function validateFiniteModelOrientation(orientation: ModelOrientation): void {
    if (!isFiniteNumber(orientation.heading) || !isFiniteNumber(orientation.tilt) || !isFiniteNumber(orientation.roll)) {
        throw new Error('Model orientation must contain only finite numbers');
    }
}

function validateFiniteModelScale(scale: ModelScale): void {
    if (!isFiniteNumber(scale.x) || !isFiniteNumber(scale.y) || !isFiniteNumber(scale.z)) {
        throw new Error('Model scale must contain only finite numbers');
    }
}

function validateVertexIndex(index: number, length: number, allowEnd: boolean): void {
    if (!Number.isInteger(index)) {
        throw new Error('Vertex index must be an integer');
    }

    const upperBound = allowEnd ? length : length - 1;
    if (index < 0 || index > upperBound) {
        throw new Error('Vertex index is out of range');
    }
}

function requireFeature<T extends FeatureType>(document: IKmlDocument, featureId: FeatureId, expectedType?: T): FeatureOfType<T> {
    const feature = document.getFeatureById(featureId);
    if (!feature) {
        throw new Error(`Feature ${String(featureId)} not found`);
    }

    if (expectedType && feature.type !== expectedType) {
        throw new Error(`Feature ${String(featureId)} is not a ${expectedType}`);
    }

    return feature as FeatureOfType<T>;
}

abstract class BaseCommand implements ICommand {
    protected constructor(
        private readonly commandType: CommandType,
        protected currentFeatureId: FeatureId,
        private readonly commandDescription: string,
    ) {}

    public get type(): CommandType {
        return this.commandType;
    }

    public get featureId(): FeatureId {
        return this.currentFeatureId;
    }

    public get description(): string {
        return this.commandDescription;
    }

    public abstract execute(document: IKmlDocument, geoBridge: IGeoBridge): void;

    public abstract undo(document: IKmlDocument, geoBridge: IGeoBridge): void;
}

abstract class TextCommand extends BaseCommand {
    private originalValue: string | null = null;

    protected constructor(commandType: CommandType, featureId: FeatureId, description: string, private readonly fieldName: 'name' | 'description', private readonly nextValue: string) {
        super(commandType, featureId, description);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId);
        if (this.originalValue === null) {
            this.originalValue = feature[this.fieldName];
        }

        feature[this.fieldName] = this.nextValue;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalValue === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId);
        feature[this.fieldName] = this.originalValue;
    }
}

abstract class SpatialCommand extends BaseCommand {
    protected constructor(commandType: CommandType, featureId: FeatureId, description: string) {
        super(commandType, featureId, description);
    }
}

class MoveMarkerCommand extends SpatialCommand {
    private originalPosition: GeoPosition | null = null;

    public constructor(featureId: FeatureId, private readonly targetWorldPosition: WorldPosition) {
        super('move-marker', featureId, `Move marker ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, geoBridge: IGeoBridge): void {
        validateWorldPosition(this.targetWorldPosition);
        const feature = requireFeature(document, this.currentFeatureId, 'marker') as IMarkerFeature;
        if (this.originalPosition === null) {
            this.originalPosition = cloneGeoPosition(feature.position);
        }

        feature.position = geoBridge.worldToGeo(cloneWorldPosition(this.targetWorldPosition), 'absolute');
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalPosition === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId, 'marker') as IMarkerFeature;
        feature.position = cloneGeoPosition(this.originalPosition);
    }
}

class MoveLineVertexCommand extends SpatialCommand {
    private originalCoordinates: GeoPosition[] | null = null;

    public constructor(featureId: FeatureId, private readonly vertexIndex: number, private readonly targetWorldPosition: WorldPosition) {
        super('move-line-vertex', featureId, `Move line vertex ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, geoBridge: IGeoBridge): void {
        validateWorldPosition(this.targetWorldPosition);
        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        validateVertexIndex(this.vertexIndex, feature.coordinates.length, false);

        if (this.originalCoordinates === null) {
            this.originalCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        }

        const nextCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        nextCoordinates[this.vertexIndex] = geoBridge.worldToGeo(cloneWorldPosition(this.targetWorldPosition), 'absolute');
        feature.coordinates = nextCoordinates;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalCoordinates === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        feature.coordinates = this.originalCoordinates.map((coordinate) => cloneGeoPosition(coordinate));
    }
}

class AddLineVertexCommand extends SpatialCommand {
    private originalCoordinates: GeoPosition[] | null = null;

    public constructor(featureId: FeatureId, private readonly vertexIndex: number, private readonly targetWorldPosition: WorldPosition) {
        super('add-line-vertex', featureId, `Add line vertex ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, geoBridge: IGeoBridge): void {
        validateWorldPosition(this.targetWorldPosition);
        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        validateVertexIndex(this.vertexIndex, feature.coordinates.length, true);

        if (this.originalCoordinates === null) {
            this.originalCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        }

        const nextCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        nextCoordinates.splice(this.vertexIndex, 0, geoBridge.worldToGeo(cloneWorldPosition(this.targetWorldPosition), 'absolute'));
        feature.coordinates = nextCoordinates;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalCoordinates === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        feature.coordinates = this.originalCoordinates.map((coordinate) => cloneGeoPosition(coordinate));
    }
}

class RemoveLineVertexCommand extends SpatialCommand {
    private originalCoordinates: GeoPosition[] | null = null;

    public constructor(featureId: FeatureId, private readonly vertexIndex: number) {
        super('remove-line-vertex', featureId, `Remove line vertex ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        validateVertexIndex(this.vertexIndex, feature.coordinates.length, false);

        if (this.originalCoordinates === null) {
            this.originalCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        }

        const nextCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        nextCoordinates.splice(this.vertexIndex, 1);
        feature.coordinates = nextCoordinates;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalCoordinates === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        feature.coordinates = this.originalCoordinates.map((coordinate) => cloneGeoPosition(coordinate));
    }
}

abstract class OverlayCommand extends SpatialCommand {
    private originalLatLonBox: LatLonBox | null = null;
    private originalAltitude: number | null = null;
    private originalAltitudeMode: AltitudeMode | null = null;

    protected constructor(commandType: CommandType, featureId: FeatureId, description: string) {
        super(commandType, featureId, description);
    }

    protected rememberOverlayState(feature: IGroundOverlayFeature): void {
        if (this.originalLatLonBox === null) {
            this.originalLatLonBox = cloneLatLonBox(feature.latLonBox);
            this.originalAltitude = feature.altitude;
            this.originalAltitudeMode = feature.altitudeMode;
        }
    }

    protected restoreOverlayState(feature: IGroundOverlayFeature): void {
        if (this.originalLatLonBox === null || this.originalAltitude === null || this.originalAltitudeMode === null) {
            return;
        }

        feature.latLonBox = cloneLatLonBox(this.originalLatLonBox);
        feature.altitude = this.originalAltitude;
        feature.altitudeMode = this.originalAltitudeMode;
    }
}

class MoveOverlayCommand extends OverlayCommand {
    public constructor(
        featureId: FeatureId,
        private readonly targetLatLonBox: LatLonBox,
        private readonly targetAltitude: number,
        private readonly targetAltitudeMode: AltitudeMode,
    ) {
        super('move-overlay', featureId, `Move overlay ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFiniteLatLonBox(this.targetLatLonBox);
        if (!isFiniteNumber(this.targetAltitude)) {
            throw new Error('Overlay altitude must be finite');
        }

        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.rememberOverlayState(feature);
        feature.latLonBox = cloneLatLonBox(this.targetLatLonBox);
        feature.altitude = this.targetAltitude;
        feature.altitudeMode = this.targetAltitudeMode;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.restoreOverlayState(feature);
    }
}

class ScaleOverlayCommand extends OverlayCommand {
    public constructor(featureId: FeatureId, private readonly targetLatLonBox: LatLonBox) {
        super('scale-overlay', featureId, `Scale overlay ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFiniteLatLonBox(this.targetLatLonBox);
        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.rememberOverlayState(feature);
        feature.latLonBox = cloneLatLonBox(this.targetLatLonBox);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.restoreOverlayState(feature);
    }
}

class RotateOverlayCommand extends OverlayCommand {
    public constructor(featureId: FeatureId, private readonly targetRotation: number) {
        super('rotate-overlay', featureId, `Rotate overlay ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (!isFiniteNumber(this.targetRotation)) {
            throw new Error('Overlay rotation must be finite');
        }

        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.rememberOverlayState(feature);
        feature.latLonBox = { ...feature.latLonBox, rotation: this.targetRotation };
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.restoreOverlayState(feature);
    }
}

abstract class ModelCommand extends SpatialCommand {
    private originalLocation: GeoPosition | null = null;
    private originalOrientation: ModelOrientation | null = null;
    private originalScale: ModelScale | null = null;
    private originalAltitudeMode: AltitudeMode | null = null;

    protected constructor(commandType: CommandType, featureId: FeatureId, description: string) {
        super(commandType, featureId, description);
    }

    protected rememberModelState(feature: IModelFeature): void {
        if (this.originalLocation === null) {
            this.originalLocation = cloneGeoPosition(feature.location);
            this.originalOrientation = cloneModelOrientation(feature.orientation);
            this.originalScale = cloneModelScale(feature.scale);
            this.originalAltitudeMode = feature.altitudeMode;
        }
    }

    protected restoreModelState(feature: IModelFeature): void {
        if (this.originalLocation === null || this.originalOrientation === null || this.originalScale === null || this.originalAltitudeMode === null) {
            return;
        }

        feature.location = cloneGeoPosition(this.originalLocation);
        feature.orientation = cloneModelOrientation(this.originalOrientation);
        feature.scale = cloneModelScale(this.originalScale);
        feature.altitudeMode = this.originalAltitudeMode;
    }
}

class MoveModelCommand extends ModelCommand {
    public constructor(featureId: FeatureId, private readonly targetLocation: GeoPosition) {
        super('move-model', featureId, `Move model ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFinitePosition(this.targetLocation, 'Model location');
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.rememberModelState(feature);
        feature.location = cloneGeoPosition(this.targetLocation);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.restoreModelState(feature);
    }
}

class ScaleModelCommand extends ModelCommand {
    public constructor(featureId: FeatureId, private readonly targetScale: ModelScale) {
        super('scale-model', featureId, `Scale model ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFiniteModelScale(this.targetScale);
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.rememberModelState(feature);
        feature.scale = cloneModelScale(this.targetScale);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.restoreModelState(feature);
    }
}

class RotateModelCommand extends ModelCommand {
    public constructor(featureId: FeatureId, private readonly targetOrientation: ModelOrientation) {
        super('rotate-model', featureId, `Rotate model ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFiniteModelOrientation(this.targetOrientation);
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.rememberModelState(feature);
        feature.orientation = cloneModelOrientation(this.targetOrientation);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.restoreModelState(feature);
    }
}

class CreateFeatureCommand extends BaseCommand {
    public constructor(private readonly template: FeatureTemplate, private readonly afterId?: FeatureId) {
        super('create-feature', '' as FeatureId, `Create feature ${template.type}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        this.currentFeatureId = document.insertFeature(this.template, this.afterId);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (!this.currentFeatureId) {
            return;
        }

        document.removeFeature(this.currentFeatureId);
    }
}

class DeleteFeatureCommand extends BaseCommand {
    private snapshot: FeatureSnapshot | null = null;

    public constructor(featureId: FeatureId, private readonly afterId?: FeatureId) {
        super('delete-feature', featureId, `Delete feature ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        this.snapshot = document.removeFeature(this.currentFeatureId);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (!this.snapshot) {
            return;
        }

        document.restoreFeature(this.snapshot, this.afterId);
    }
}

class CommandStack implements ICommandStack {
    private readonly history: ICommand[] = [];
    private cursor = 0;
    private readonly listeners = new Set<Listener>();

    public constructor(private readonly document: IKmlDocument, private readonly geoBridge: IGeoBridge) {}

    public execute(command: ICommand): void {
        command.execute(this.document, this.geoBridge);
        this.history.splice(this.cursor);
        this.history.push(command);
        this.cursor = this.history.length;
        this.notify();
    }

    public undo(): ICommand | null {
        if (!this.canUndo()) {
            return null;
        }

        const command = this.history[this.cursor - 1];
        command.undo(this.document, this.geoBridge);
        this.cursor -= 1;
        this.notify();
        return command;
    }

    public redo(): ICommand | null {
        if (!this.canRedo()) {
            return null;
        }

        const command = this.history[this.cursor];
        command.execute(this.document, this.geoBridge);
        this.cursor += 1;
        this.notify();
        return command;
    }

    public canUndo(): boolean {
        return this.cursor > 0;
    }

    public canRedo(): boolean {
        return this.cursor < this.history.length;
    }

    public onChange(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}

export function createCommandStack(document: IKmlDocument, geoBridge: IGeoBridge): ICommandStack {
    return new CommandStack(document, geoBridge);
}

class SetNameCommand extends TextCommand {
    public constructor(featureId: FeatureId, nextName: string) {
        super('set-name', featureId, `Set name ${String(featureId)}`, 'name', nextName);
    }
}

class SetDescriptionCommand extends TextCommand {
    public constructor(featureId: FeatureId, nextDescription: string) {
        super('set-description', featureId, `Set description ${String(featureId)}`, 'description', nextDescription);
    }
}

export function createSetNameCommand(featureId: FeatureId, nextName: string): ICommand {
    return new SetNameCommand(featureId, nextName);
}

export function createSetDescriptionCommand(featureId: FeatureId, nextDescription: string): ICommand {
    return new SetDescriptionCommand(featureId, nextDescription);
}

export function createMoveMarkerCommand(featureId: FeatureId, targetWorldPosition: WorldPosition): ICommand {
    return new MoveMarkerCommand(featureId, targetWorldPosition);
}

export function createMoveLineVertexCommand(featureId: FeatureId, vertexIndex: number, targetWorldPosition: WorldPosition): ICommand {
    return new MoveLineVertexCommand(featureId, vertexIndex, targetWorldPosition);
}

export function createAddLineVertexCommand(featureId: FeatureId, vertexIndex: number, targetWorldPosition: WorldPosition): ICommand {
    return new AddLineVertexCommand(featureId, vertexIndex, targetWorldPosition);
}

export function createRemoveLineVertexCommand(featureId: FeatureId, vertexIndex: number): ICommand {
    return new RemoveLineVertexCommand(featureId, vertexIndex);
}

export function createMoveOverlayCommand(featureId: FeatureId, targetLatLonBox: LatLonBox, targetAltitude: number, targetAltitudeMode: AltitudeMode): ICommand {
    return new MoveOverlayCommand(featureId, targetLatLonBox, targetAltitude, targetAltitudeMode);
}

export function createScaleOverlayCommand(featureId: FeatureId, targetLatLonBox: LatLonBox): ICommand {
    return new ScaleOverlayCommand(featureId, targetLatLonBox);
}

export function createRotateOverlayCommand(featureId: FeatureId, targetRotation: number): ICommand {
    return new RotateOverlayCommand(featureId, targetRotation);
}

export function createMoveModelCommand(featureId: FeatureId, targetLocation: GeoPosition): ICommand {
    return new MoveModelCommand(featureId, targetLocation);
}

export function createScaleModelCommand(featureId: FeatureId, targetScale: ModelScale): ICommand {
    return new ScaleModelCommand(featureId, targetScale);
}

export function createRotateModelCommand(featureId: FeatureId, targetOrientation: ModelOrientation): ICommand {
    return new RotateModelCommand(featureId, targetOrientation);
}

export function createCreateFeatureCommand(template: FeatureTemplate, afterId?: FeatureId): ICommand {
    return new CreateFeatureCommand(template, afterId);
}

export function createDeleteFeatureCommand(featureId: FeatureId, afterId?: FeatureId): ICommand {
    return new DeleteFeatureCommand(featureId, afterId);
}