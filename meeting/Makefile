.PHONY: build buildx

all: buildx login deploy
all-stg: buildx login deploy-stg
all-prod: buildx login deploy-prod

buildx:
	docker buildx build --platform linux/amd64 -t meet-bot-api .

build:
	docker build -t meet-bot-api .

deploy:
	docker tag meet-bot-api:latest 322607082550.dkr.ecr.ap-northeast-1.amazonaws.com/meet-bot-api:development-latest
	docker push 322607082550.dkr.ecr.ap-northeast-1.amazonaws.com/meet-bot-api:development-latest
	aws ecs update-service --cluster primary-development --service meet-bot-development --force-new-deployment

deploy-stg:
	docker tag meet-bot-api:latest 322607082550.dkr.ecr.ap-northeast-1.amazonaws.com/meet-bot-api:staging-latest
	docker push 322607082550.dkr.ecr.ap-northeast-1.amazonaws.com/meet-bot-api:staging-latest
	aws ecs update-service --cluster primary-staging --service meet-bot-staging --force-new-deployment

deploy-prod:
	docker tag meet-bot-api:latest 322607082550.dkr.ecr.ap-northeast-1.amazonaws.com/meet-bot-api:production-latest
	docker push 322607082550.dkr.ecr.ap-northeast-1.amazonaws.com/meet-bot-api:latest
	aws ecs update-service --cluster primary-production --service meet-bot-production --force-new-deployment

clean:

dev: .env
	npm run dev

login:
	aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin 322607082550.dkr.ecr.ap-northeast-1.amazonaws.com

.env:
	cp .env.example .env

run: .env
	docker run --rm -p 3000:3000 --name meet-bot-api -v ~/.aws:/home/pulseuser/.aws:ro -e AWS_PROFILE=default --env-file=.env meet-bot-api:latest
