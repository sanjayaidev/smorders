import "dotenv/config";

// Singapore region by default - override with ALIBABA_REGION if this ever
// deploys somewhere else. The base URL is scoped to your Model Studio
// workspace, same pattern as the ImageAgent project's AlibabaProvider:
//   https://{workspace_id}.{region}.maas.aliyuncs.com/compatible-mode/v1
const DEFAULT_REGION = "ap-southeast-1";
const DEFAULT_MODEL = "qwen-plus";

/**
 * Calls Alibaba Cloud Model Studio's OpenAI-compatible chat completions
 * endpoint (workspace-scoped) and returns the assistant message's raw text
 * content (the caller parses it as JSON).
 *
 * @param {Array<{role: string, content: string}>} messages
 */
export async function callDashScopeChat(messages) {
  const apiKey = process.env.ALIBABA_API_KEY;
  const workspaceId = process.env.ALIBABA_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    throw new Error(
      "Missing ALIBABA_API_KEY or ALIBABA_WORKSPACE_ID. Set both in your environment (from the Model Studio console, Singapore/international workspace)."
    );
  }

  const region = process.env.ALIBABA_REGION || DEFAULT_REGION;
  const model = process.env.ALIBABA_MODEL || DEFAULT_MODEL;
  const baseUrl = `https://${workspaceId}.${region}.maas.aliyuncs.com/compatible-mode/v1`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Alibaba chat request failed with status ${response.status}`;
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Alibaba Model Studio returned an empty response.");
  return content;
}
