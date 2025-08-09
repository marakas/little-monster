# Google meeting recorder bot

nodeJS project
runs on port 3000

## Handles following commands:

### Start recording

curl -X POST http://localhost:3000/start-meet-bot \
 -H "Content-Type: application/json" \
 -d '{"meetUrl": "https://meet.google.com/nzn-zqyr-cxy"}'

### Get transcription

curl -X GET http://localhost:3000/transcriptions

### Stop recording

curl -X POST http://localhost:3000/stop-meet-bot

## Build

- make buildx
  -- for aws builds (amd64)

- make build
  -- for local (mac silicon) build

- make deploy
  -- deploy to aws ecr as latest

- bump 1