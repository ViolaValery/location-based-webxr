import { IKmlDocument, IMarkerFeature } from '../contracts/document-model';
import { FeatureId, FeatureSnapshot, FeatureTemplate } from '../contracts/type';

export function createKmlDocument(): IKmlDocument {
    return {
        parse: (kmlString: string) => { throw new Error('Not implemented'); },
        serialize: () => { throw new Error('Not implemented'); },
        getFeatures: () => { throw new Error('Not implemented'); },
        getFeatureById: (id: FeatureId) => null,
        insertFeature: (template: FeatureTemplate, afterId?: FeatureId) => { throw new Error('Not implemented'); },
        removeFeature: (id: FeatureId) => { throw new Error('Not implemented'); },
        restoreFeature: (snapshot: FeatureSnapshot, afterId?: FeatureId) => { throw new Error('Not implemented'); }
    };
}
