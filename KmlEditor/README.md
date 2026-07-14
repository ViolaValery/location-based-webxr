# Demos starten
```bash
pnpm run dev:geo-bridge
```
# How to use Key APIs for record/replay of Task 1 walks for e2e tests

Following APIs provide needed interfaces between the Task 1 walk files and the KML/KMZ Editor:
- exportSessionAsZip(sessionHandle, { contributors? }) converts walk session file into a ZIP-blob (zip-file not yet stored in memory but in RAM)
- replayRecording(store, blob) feeds a ZIP-blob into the KML editors store where it can be read/used for actions
- loadActionsFromZip(blob) / loadEntriesFromSubdir(blob, subdir) draws actions from walk file
