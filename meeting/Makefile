.PHONY: build buildx

buildx:
	docker buildx build --platform linux/amd64 -t design-bot .

build:
	docker build -t design-bot .

build-no-cache:
	docker build --no-cache -t design-bot .

clean:

dev: .env
	npm run dev

.env:
	cp .env.example .env

run:
	docker run --rm -it -p 3000:3000 --name design-bot --env-file .env -e LOCAL_MODE=1 design-bot

