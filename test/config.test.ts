import { describe, it, expect } from "vitest";
import { resolveConfig, loadSettings } from "../src/config.js";

describe("resolveConfig", () => {
	it("throws when baseUrl is missing from settings.json", () => {
		const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		const mockReadFile = () => {
			throw enoentError;
		};

		expect(() =>
			resolveConfig({
				readFile: mockReadFile,
				cwd: () => "/fake/cwd",
				homedir: () => "/fake/home",
			}),
		).toThrow("LiteLLM baseUrl is required");
	});

	it("normalizes URL without trailing slash", () => {
		const mockReadFile = () =>
			JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://localhost:4000",
				},
			});

		const config = resolveConfig({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(config.baseUrl).toBe("http://localhost:4000/v1");
	});

	it("normalizes URL with trailing slash", () => {
		const mockReadFile = () =>
			JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://localhost:4000/",
				},
			});

		const config = resolveConfig({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(config.baseUrl).toBe("http://localhost:4000/v1");
	});

	it("does not double-add /v1 when URL already ends with /v1", () => {
		const mockReadFile = () =>
			JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://localhost:4000/v1",
				},
			});

		const config = resolveConfig({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(config.baseUrl).toBe("http://localhost:4000/v1");
	});

	it("throws when URL is invalid", () => {
		const mockReadFile = () =>
			JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "not-a-url",
				},
			});

		expect(() =>
			resolveConfig({
				readFile: mockReadFile,
				cwd: () => "/fake/cwd",
				homedir: () => "/fake/home",
			}),
		).toThrow("Invalid base URL");
	});

	it("returns undefined modelOverrides when config file is missing", () => {
		const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		const mockReadFile = (path: string) => {
			if (path.includes("litellm.json")) throw enoentError;
			return JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://localhost:4000",
				},
			});
		};

		const config = resolveConfig({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(config.modelOverrides).toBeUndefined();
	});

	it("returns modelOverrides from valid config file", () => {
		const mockReadFile = (path: string) => {
			if (path.includes("litellm.json")) {
				return JSON.stringify({
					modelOverrides: {
						"gpt-4": { contextWindow: 32768, cost: { input: 30, output: 60 } },
					},
				});
			}
			return JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://localhost:4000",
				},
			});
		};

		const config = resolveConfig({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(config.modelOverrides).toEqual({
			"gpt-4": { contextWindow: 32768, cost: { input: 30, output: 60 } },
		});
	});

	it("throws with helpful message when config file JSON is invalid", () => {
		const mockReadFile = (path: string) => {
			if (path.includes("litellm.json")) return "{ invalid json";
			return JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://localhost:4000",
				},
			});
		};

		expect(() =>
			resolveConfig({
				readFile: mockReadFile,
				cwd: () => "/fake/cwd",
				homedir: () => "/fake/home",
			}),
		).toThrow("Failed to parse .pi/litellm.json");
	});

	it("includes apiKey when set in settings.json", () => {
		const mockReadFile = () =>
			JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://localhost:4000",
					apiKey: "sk-test-123",
				},
			});

		const config = resolveConfig({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(config.apiKey).toBe("sk-test-123");
	});

	it("returns undefined apiKey when not in settings.json", () => {
		const mockReadFile = () =>
			JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://localhost:4000",
				},
			});

		const config = resolveConfig({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(config.apiKey).toBeUndefined();
	});
});

describe("loadSettings", () => {
	it("returns undefined when both settings files are missing", () => {
		const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		const mockReadFile = () => {
			throw enoentError;
		};

		const settings = loadSettings({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(settings).toBeUndefined();
	});

	it("reads global settings when project-local is missing", () => {
		const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		const mockReadFile = (path: string) => {
			if (path === "/fake/cwd/.pi/settings.json") throw enoentError;
			return JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://global:4000",
					apiKey: "sk-global",
				},
			});
		};

		const settings = loadSettings({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(settings).toEqual({
			baseUrl: "http://global:4000",
			apiKey: "sk-global",
		});
	});

	it("prefers project-local over global", () => {
		const mockReadFile = (path: string) => {
			if (path === "/fake/cwd/.pi/settings.json") {
				return JSON.stringify({
					"github.com/andrewhowdencom/pi.litellm": {
						baseUrl: "http://project:4000",
						apiKey: "sk-project",
					},
				});
			}
			return JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://global:4000",
					apiKey: "sk-global",
				},
			});
		};

		const settings = loadSettings({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(settings).toEqual({
			baseUrl: "http://project:4000",
			apiKey: "sk-project",
		});
	});

	it("falls back to global when project-local lacks repo key", () => {
		const mockReadFile = (path: string) => {
			if (path === "/fake/cwd/.pi/settings.json") {
				return JSON.stringify({ otherKey: {} });
			}
			return JSON.stringify({
				"github.com/andrewhowdencom/pi.litellm": {
					baseUrl: "http://global:4000",
				},
			});
		};

		const settings = loadSettings({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(settings).toEqual({ baseUrl: "http://global:4000" });
	});

	it("returns undefined when repo key is missing from both files", () => {
		const mockReadFile = () => JSON.stringify({ otherKey: {} });

		const settings = loadSettings({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(settings).toBeUndefined();
	});

	it("returns undefined on malformed JSON", () => {
		const mockReadFile = () => "{ invalid json";

		const settings = loadSettings({
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
			homedir: () => "/fake/home",
		});

		expect(settings).toBeUndefined();
	});
});
