// Zentraler Editor-State (verbindet alle Komponenten)

interface IEditorStore {
    /** Aktuell geladenes Dokument */
    readonly document: IKmlDocument | null;
    /** Aktueller Container */
    readonly container: IKmzContainer | null;
    /** Command-Stack (Undo/Redo) */
    readonly commands: ICommandStack;
    /** Geo-Bridge */
    readonly geoBridge: IGeoBridge;
    /** Aktuell selektiertes Feature */
    readonly selectedFeatureId: FeatureId | null;

    /** Datei laden */
    loadFile(file: File): Promise<void>;
    /** Feature selektieren */
    selectFeature(id: FeatureId | null): void;
    /** Command ausführen (geht durch den Stack) */
    executeCommand(command: ICommand): void;

    /** Listener für State-Änderungen */
    subscribe(listener: (state: EditorState) => void): () => void;
}
