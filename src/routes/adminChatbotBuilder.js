import { Router } from "express";
import { supabase } from "../supabaseClient.js";
import { reservedOrderKeyword } from "../lib/orderKeywords.js";

const router = Router();

function cleanKeywords(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function validateKeywords(keywords) {
  const reserved = keywords.find((keyword) => reservedOrderKeyword(keyword));
  if (reserved) return `"${reserved}" is reserved by the order system.`;
  return null;
}

function rulePayload(body = {}) {
  const keywords = cleanKeywords(body.keywords);
  return {
    name: String(body.name || "New rule").trim(),
    keywords,
    match_type: body.matchType || body.match_type || "contains",
    action_type: body.action?.type || body.action_type || "template",
    action_template_id: body.action?.templateId || body.action_template_id || null,
    ai_prompt: String(body.action?.aiPrompt ?? body.ai_prompt ?? ""),
    ai_fallback: String(body.action?.aiFallback ?? body.ai_fallback ?? ""),
    action_config: body.action?.config || body.action_config || {},
    conditions: body.conditions || [],
    else_template_id: body.elseTemplateId || body.else_template_id || null,
    follow_up: body.followUp || body.follow_up || { enabled: false },
  };
}

function rejectInvalidRule(body, res) {
  const payload = rulePayload(body);
  const keywordError = validateKeywords(payload.keywords);
  if (keywordError) {
    res.status(400).json({ error: keywordError });
    return null;
  }
  if (!payload.name || !["contains", "exact"].includes(payload.match_type)) {
    res.status(400).json({ error: "A rule name and valid match type are required." });
    return null;
  }
  return payload;
}

router.get("/rules", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("wb_bot_rules").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ rules: data });
  } catch (error) { next(error); }
});

router.post("/rules", async (req, res, next) => {
  try {
    const payload = rejectInvalidRule(req.body, res);
    if (!payload) return;
    const { data, error } = await supabase.from("wb_bot_rules").insert(payload).select().single();
    if (error) throw error;
    res.status(201).json({ rule: data });
  } catch (error) { next(error); }
});

router.put("/rules/:id", async (req, res, next) => {
  try {
    const payload = rejectInvalidRule(req.body, res);
    if (!payload) return;
    const { data, error } = await supabase.from("wb_bot_rules").update(payload).eq("id", req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Rule not found." });
    res.json({ rule: data });
  } catch (error) { next(error); }
});

router.delete("/rules/:id", async (req, res, next) => {
  try {
    const { error } = await supabase.from("wb_bot_rules").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get("/templates", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("wb_bot_templates").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ templates: data });
  } catch (error) { next(error); }
});

router.post("/templates", async (req, res, next) => {
  try {
    const { name, type = "plaintext", payload = {} } = req.body || {};
    if (!String(name || "").trim()) return res.status(400).json({ error: "Template name is required." });
    const { data, error } = await supabase.from("wb_bot_templates").insert({ name: String(name).trim(), type, payload }).select().single();
    if (error) throw error;
    res.status(201).json({ template: data });
  } catch (error) { next(error); }
});

router.put("/templates/:id", async (req, res, next) => {
  try {
    const { name, type, payload } = req.body || {};
    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (type !== undefined) patch.type = type;
    if (payload !== undefined) patch.payload = payload;
    const { data, error } = await supabase.from("wb_bot_templates").update(patch).eq("id", req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Template not found." });
    res.json({ template: data });
  } catch (error) { next(error); }
});

router.delete("/templates/:id", async (req, res, next) => {
  try {
    const { error } = await supabase.from("wb_bot_templates").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get("/knowledge", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("wb_knowledge_base").select("*").order("priority", { ascending: false }).order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ knowledge: data });
  } catch (error) { next(error); }
});

router.post("/knowledge", async (req, res, next) => {
  try {
    const { title, content, active = true, priority = 0 } = req.body || {};
    if (!String(title || "").trim() || !String(content || "").trim()) return res.status(400).json({ error: "Title and content are required." });
    const { data, error } = await supabase.from("wb_knowledge_base").insert({ title: String(title).trim(), content: String(content).trim(), active: Boolean(active), priority: Number(priority) || 0 }).select().single();
    if (error) throw error;
    res.status(201).json({ knowledge: data });
  } catch (error) { next(error); }
});

router.patch("/knowledge/:id", async (req, res, next) => {
  try {
    const patch = {};
    if (req.body?.title !== undefined) patch.title = String(req.body.title).trim();
    if (req.body?.content !== undefined) patch.content = String(req.body.content).trim();
    if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
    if (req.body?.priority !== undefined) patch.priority = Number(req.body.priority) || 0;
    const { data, error } = await supabase.from("wb_knowledge_base").update(patch).eq("id", req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Knowledge entry not found." });
    res.json({ knowledge: data });
  } catch (error) { next(error); }
});

router.delete("/knowledge/:id", async (req, res, next) => {
  try {
    const { error } = await supabase.from("wb_knowledge_base").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
