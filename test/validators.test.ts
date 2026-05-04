import { describe, it, expect } from "vitest";
import { isValidModelInfoResponse, isValidModelsResponse } from "../src/model-discovery.js";

describe("isValidModelInfoResponse", () => {
	it.each([
		{
			name: "valid exact shape",
			input: { data: [{ model_name: "gpt-4" }] },
			expected: true,
		},
		{
			name: "valid with extra fields",
			input: { data: [{ model_name: "gpt-4", extra: true }], meta: {} },
			expected: true,
		},
		{
			name: "empty data array",
			input: { data: [] },
			expected: true,
		},
		{
			name: "missing data field",
			input: { models: [] },
			expected: false,
		},
		{
			name: "data is not an array",
			input: { data: "not-array" },
			expected: false,
		},
		{
			name: "null root",
			input: null,
			expected: false,
		},
		{
			name: "primitive root",
			input: "string",
			expected: false,
		},
		{
			name: "number root",
			input: 42,
			expected: false,
		},
		{
			name: "array root",
			input: [],
			expected: false,
		},
		{
			name: "data array with non-object elements",
			input: { data: ["string", 42, null] },
			expected: true,
		},
	])("$name", ({ input, expected }) => {
		expect(isValidModelInfoResponse(input)).toBe(expected);
	});
});

describe("isValidModelsResponse", () => {
	it.each([
		{
			name: "valid exact shape",
			input: { data: [{ id: "gpt-4" }] },
			expected: true,
		},
		{
			name: "valid with extra fields",
			input: { data: [{ id: "gpt-4", object: "model" }], meta: {} },
			expected: true,
		},
		{
			name: "empty data array",
			input: { data: [] },
			expected: true,
		},
		{
			name: "missing data field",
			input: { models: [] },
			expected: false,
		},
		{
			name: "data is not an array",
			input: { data: "not-array" },
			expected: false,
		},
		{
			name: "null root",
			input: null,
			expected: false,
		},
		{
			name: "primitive root",
			input: "string",
			expected: false,
		},
		{
			name: "number root",
			input: 42,
			expected: false,
		},
		{
			name: "array root",
			input: [],
			expected: false,
		},
		{
			name: "data array with non-object elements",
			input: { data: ["string", 42, null] },
			expected: true,
		},
	])("$name", ({ input, expected }) => {
		expect(isValidModelsResponse(input)).toBe(expected);
	});
});
