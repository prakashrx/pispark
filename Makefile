.PHONY: help install dev check test build start smoke

help:
	@echo "PiSpark: install dev check test build start smoke"
	@echo "No make? Use npm ci, npm test, or npm run <target>."

install:
	npm ci

dev:
	npm run dev

check:
	npm run check

test:
	npm test

build:
	npm run build

start:
	npm start

smoke:
	npm run smoke
