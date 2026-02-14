/**
 * API client for assessment endpoints.
 *
 * Supports both authenticated users (JWT via cookie) and anonymous users
 * (via X-Anonymous-Token header).
 */

import { API_URL } from "../config";
import { getAnonymousToken } from "../hooks/useAnonymousToken";
import { fetchWithRefresh } from "./fetchWithRefresh";

const API_BASE = API_URL;

interface AuthHeaders {
  Authorization?: string;
  "X-Anonymous-Token"?: string;
}

function getAuthHeaders(isAuthenticated: boolean): AuthHeaders {
  if (isAuthenticated) {
    // JWT is sent via credentials: include
    return {};
  }
  return { "X-Anonymous-Token": getAnonymousToken() };
}

// --- Types ---

export interface CreateResponseParams {
  questionId: string;
  moduleSlug: string;
  learningOutcomeId?: string | null;
  contentId?: string | null;
  answerText: string;
  answerMetadata?: Record<string, unknown>;
}

export interface CreateResponseResult {
  response_id: number;
  created_at: string;
}

export interface UpdateResponseParams {
  answerText?: string;
  answerMetadata?: Record<string, unknown>;
  completedAt?: string | null;
}

export interface UpdateResponseResult {
  response_id: number;
  created_at: string;
}

export interface ResponseItem {
  response_id: number;
  question_id: string;
  module_slug: string;
  learning_outcome_id: string | null;
  answer_text: string;
  answer_metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface GetResponsesResult {
  responses: ResponseItem[];
}

// --- API Functions ---

export async function createResponse(
  params: CreateResponseParams,
  isAuthenticated: boolean,
): Promise<CreateResponseResult> {
  const res = await fetchWithRefresh(`${API_BASE}/api/assessments/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(isAuthenticated),
    },
    credentials: "include",
    body: JSON.stringify({
      question_id: params.questionId,
      module_slug: params.moduleSlug,
      learning_outcome_id: params.learningOutcomeId ?? null,
      content_id: params.contentId ?? null,
      answer_text: params.answerText,
      answer_metadata: params.answerMetadata ?? {},
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create response: ${res.status}`);
  }

  return res.json();
}

export async function updateResponse(
  responseId: number,
  params: UpdateResponseParams,
  isAuthenticated: boolean,
): Promise<UpdateResponseResult> {
  const body: Record<string, unknown> = {};
  if (params.answerText !== undefined) {
    body.answer_text = params.answerText;
  }
  if (params.answerMetadata !== undefined) {
    body.answer_metadata = params.answerMetadata;
  }
  if (params.completedAt !== undefined) {
    body.completed_at = params.completedAt;
  }

  const res = await fetchWithRefresh(
    `${API_BASE}/api/assessments/responses/${responseId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(isAuthenticated),
      },
      credentials: "include",
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to update response: ${res.status}`);
  }

  return res.json();
}

export async function getResponses(
  params: {
    moduleSlug: string;
    questionId: string;
  },
  isAuthenticated: boolean,
): Promise<GetResponsesResult> {
  const searchParams = new URLSearchParams({
    module_slug: params.moduleSlug,
    question_id: params.questionId,
  });

  const res = await fetchWithRefresh(
    `${API_BASE}/api/assessments/responses?${searchParams}`,
    {
      method: "GET",
      headers: {
        ...getAuthHeaders(isAuthenticated),
      },
      credentials: "include",
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to get responses: ${res.status}`);
  }

  return res.json();
}
