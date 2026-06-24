/**
 * 模型注册中心 — 统一管理所有图片生成模型
 * 
 * 设计原则：
 * 1. 所有模型定义集中在一个文件，手动编辑即可增删改
 * 2. 运行时状态（额度耗尽、下线等）持久化到 localStorage
 * 3. UI 只加载状态为 active 的模型
 * 4. 其他功能模块通过 API 查询模型属性，不再散落 if-else
 * 
 * 手动维护方式：
 * - 添加模型：在 MODELS 数组中插入新条目
 * - 移除模型：删除对应条目或设置 status: 'offline'
 * - 修改属性：直接编辑对应字段
 */

const ModelRegistry = (() => {
  'use strict';

  // ======================== 静态模型定义 ========================
  // ★ 手动编辑此数组即可管理所有模型 ★
  const MODELS = [
    // ────────── Pollinations (免费·限流) ──────────
    {
      id: 'flux', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Flux Schnell', desc: '默认推荐', status: 'active',
      maxResolution: 1440, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://pollinations.ai/', websiteLabel: 'Pollinations'
    },
    {
      id: 'zimage', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Z-Image Turbo', desc: '极速生成', status: 'active',
      maxResolution: 1440, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://zimage.design/', websiteLabel: 'Z Image'
    },
    {
      id: 'seedream', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Seedream 4.0', desc: '创意风格', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://seedream.art/', websiteLabel: 'Seedream'
    },
    {
      id: 'sana', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Sana', desc: '原生1:1', status: 'active',
      maxResolution: 1024, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://github.com/NVlabs/Sana', websiteLabel: 'GitHub'
    },
    {
      id: 'klein', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'FLUX.2 Klein 4B', desc: '最新轻量', status: 'active',
      maxResolution: 1440, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },
    {
      id: 'qwen-image', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Qwen Image Plus', desc: '通义千问', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1328, h: 1328 },
      qualityMode: 'none', pricing: 'free', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://tongyi.aliyun.com/', websiteLabel: '通义千问'
    },
    {
      id: 'grok-imagine', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Grok Imagine', desc: 'xAI 出品', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://x.ai/', websiteLabel: 'xAI'
    },
    {
      id: 'ideogram-v4-turbo', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Ideogram 4.0 Turbo', desc: '文字渲染', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://ideogram.ai/', websiteLabel: 'Ideogram'
    },
    {
      id: 'nanobanana', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'NanoBanana', desc: '轻量免费', status: 'active',
      maxResolution: 1024, nativeSize: { w: 512, h: 512 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://pollinations.ai/', websiteLabel: 'Pollinations'
    },
    {
      id: 'nanobanana-pro', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'NanoBanana Pro', desc: '增强免费', status: 'active',
      maxResolution: 1024, nativeSize: { w: 512, h: 512 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://pollinations.ai/', websiteLabel: 'Pollinations'
    },
    {
      id: 'nanobanana-2', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'NanoBanana 2', desc: '细节增强', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://pollinations.ai/', websiteLabel: 'Pollinations'
    },
    {
      id: 'kontext', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'FLUX.1 Kontext', desc: '上下文编辑', status: 'active',
      maxResolution: 1440, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },
    {
      id: 'gptimage', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'GPT Image 1 Mini', desc: '快速经济', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://openai.com/', websiteLabel: 'OpenAI'
    },
    {
      id: 'gptimage-large', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'GPT Image 1.5', desc: '高保真编辑', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://openai.com/', websiteLabel: 'OpenAI'
    },
    {
      id: 'seedream5', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Seedream 5.0 Lite', desc: '搜索推理', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://seedream.art/', websiteLabel: 'Seedream'
    },
    {
      id: 'seedream-pro', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Seedream 4.5 Pro', desc: '高级照片级', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://seedream.art/', websiteLabel: 'Seedream'
    },
    {
      id: 'ideogram-v4-balanced', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Ideogram 4.0 Balanced', desc: '均衡排印', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://ideogram.ai/', websiteLabel: 'Ideogram'
    },
    {
      id: 'ideogram-v4-quality', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Ideogram 4.0 Quality', desc: '高保真排印', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://ideogram.ai/', websiteLabel: 'Ideogram'
    },
    {
      id: 'wan-image', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Wan 2.7 Image', desc: '阿里文生图', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://tongyi.aliyun.com/wanxiang', websiteLabel: '通义万相'
    },
    {
      id: 'wan-image-pro', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Wan 2.7 Image Pro', desc: '阿里4K增强', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://tongyi.aliyun.com/wanxiang', websiteLabel: '通义万相'
    },
    {
      id: 'grok-imagine-pro', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Grok Imagine Pro', desc: 'xAI Aurora增强', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://x.ai/', websiteLabel: 'xAI'
    },
    {
      id: 'p-image', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Pruna P-Image', desc: '快速文生图', status: 'active',
      maxResolution: 1024, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://pruna.ai/', websiteLabel: 'Pruna'
    },
    {
      id: 'p-image-edit', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Pruna P-Image Edit', desc: '图生图编辑', status: 'active',
      maxResolution: 1024, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://pruna.ai/', websiteLabel: 'Pruna'
    },
    {
      id: 'nova-canvas', provider: 'pollinations', group: 'Pollinations', groupIcon: '📡',
      name: 'Nova Canvas', desc: 'Amazon生成', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'none', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://aws.amazon.com/nova/', websiteLabel: 'AWS Nova'
    },

    // ────────── Puter.js — OpenAI ──────────
    {
      id: 'gpt-image-2', provider: 'puter', group: 'OpenAI', groupIcon: '🤖',
      name: 'GPT Image 2', desc: '最新旗舰', status: 'exhausted', statusReason: 'OpenAI 免费额度已用完',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'openai-gpt2', pricing: 'paid', region: 'us',
      widthMultipleOf: null, isRatioOnly: true,
      website: 'https://platform.openai.com/', websiteLabel: 'OpenAI'
    },
    {
      id: 'gpt-image-1.5', provider: 'puter', group: 'OpenAI', groupIcon: '🤖',
      name: 'GPT Image 1.5', desc: '推荐使用', status: 'exhausted', statusReason: 'OpenAI 免费额度已用完',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'openai', pricing: 'paid', region: 'us',
      widthMultipleOf: null, isRatioOnly: true,
      website: 'https://platform.openai.com/', websiteLabel: 'OpenAI'
    },
    {
      id: 'gpt-image-1', provider: 'puter', group: 'OpenAI', groupIcon: '🤖',
      name: 'GPT Image 1', desc: '经典', status: 'exhausted', statusReason: 'OpenAI 免费额度已用完',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'openai', pricing: 'paid', region: 'us',
      widthMultipleOf: null, isRatioOnly: true,
      website: 'https://platform.openai.com/', websiteLabel: 'OpenAI'
    },
    {
      id: 'gpt-image-1-mini', provider: 'puter', group: 'OpenAI', groupIcon: '🤖',
      name: 'GPT Image 1 Mini', desc: '极速', status: 'exhausted', statusReason: 'OpenAI 免费额度已用完',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'openai', pricing: 'paid', region: 'us',
      widthMultipleOf: null, isRatioOnly: true,
      website: 'https://platform.openai.com/', websiteLabel: 'OpenAI'
    },
    {
      id: 'dall-e-3', provider: 'puter', group: 'OpenAI', groupIcon: '🤖',
      name: 'DALL·E 3', desc: '经典', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'dalle', pricing: 'paid', region: 'us',
      widthMultipleOf: null, isRatioOnly: true,
      website: 'https://openai.com/dall-e-3', websiteLabel: 'DALL·E'
    },
    {
      id: 'dall-e-2', provider: 'puter', group: 'OpenAI', groupIcon: '🤖',
      name: 'DALL·E 2', desc: '轻量', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'dalle', pricing: 'paid', region: 'us',
      widthMultipleOf: null, isRatioOnly: true,
      website: 'https://openai.com/dall-e-3', websiteLabel: 'DALL·E'
    },

    // ────────── Puter.js — Google ──────────
    {
      id: 'gemini-3.1-flash-image-preview', provider: 'puter', group: 'Google', groupIcon: '🔮',
      name: 'Gemini 3.1 Flash', desc: '最新', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'google', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://aistudio.google.com/', websiteLabel: 'AI Studio'
    },
    {
      id: 'gemini-3-pro-image-preview', provider: 'puter', group: 'Google', groupIcon: '🔮',
      name: 'Gemini 3 Pro', desc: '顶级', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'google', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://aistudio.google.com/', websiteLabel: 'AI Studio'
    },
    {
      id: 'gemini-2.5-flash-image-preview', provider: 'puter', group: 'Google', groupIcon: '🔮',
      name: 'Gemini 2.5 Flash', desc: '稳定', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'google', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://aistudio.google.com/', websiteLabel: 'AI Studio'
    },
    {
      id: 'google/flash-image-2.5', provider: 'puter', group: 'Google', groupIcon: '🔮',
      name: 'Flash Image 2.5', desc: '极速', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'google', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://aistudio.google.com/', websiteLabel: 'AI Studio'
    },
    {
      id: 'google/imagen-4.0-fast', provider: 'puter', group: 'Google', groupIcon: '🔮',
      name: 'Imagen 4.0 Fast', desc: '极速', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'google', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://deepmind.google/technologies/imagen/', websiteLabel: 'Imagen'
    },
    {
      id: 'google/imagen-4.0-preview', provider: 'puter', group: 'Google', groupIcon: '🔮',
      name: 'Imagen 4.0 Preview', desc: '预览', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'google', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://deepmind.google/technologies/imagen/', websiteLabel: 'Imagen'
    },
    {
      id: 'google/imagen-4.0-ultra', provider: 'puter', group: 'Google', groupIcon: '🔮',
      name: 'Imagen 4.0 Ultra', desc: '顶级', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'google', pricing: 'free', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://deepmind.google/technologies/imagen/', websiteLabel: 'Imagen'
    },

    // ────────── Puter.js — Flux 系列 ──────────
    {
      id: 'black-forest-labs/flux-schnell', provider: 'puter', group: 'Flux', groupIcon: '🌪️',
      name: 'Flux Schnell', desc: '4步极速', status: 'active',
      maxResolution: 1440, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },
    {
      id: 'black-forest-labs/flux-1.1-pro', provider: 'puter', group: 'Flux', groupIcon: '🌪️',
      name: 'Flux 1.1 Pro', desc: '高质量', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },

    // ────────── Puter.js — Stable Diffusion ──────────
    {
      id: 'stabilityai/stable-diffusion-xl-base-1.0', provider: 'puter', group: 'Stable Diffusion', groupIcon: '🎨',
      name: 'SDXL', desc: '经典开源', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://stability.ai/', websiteLabel: 'Stability AI'
    },

    // ────────── Puter.js — 免费开源 (Together AI + Replicate) ──────────
    {
      id: 'black-forest-labs/FLUX.1-schnell', provider: 'puter', group: '开源模型', groupIcon: '🆓',
      name: 'Flux Schnell', desc: '极速开源 (Together)', status: 'active',
      maxResolution: 1440, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://www.together.ai/', websiteLabel: 'Together AI'
    },
    {
      id: 'black-forest-labs/flux-2-dev', provider: 'puter', group: '开源模型', groupIcon: '🆓',
      name: 'Flux 2 Dev', desc: '最新开源 (Replicate)', status: 'exhausted', statusReason: 'Replicate 免费额度已用完',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://replicate.com/black-forest-labs/flux-2-dev', websiteLabel: 'Replicate'
    },
    {
      id: 'black-forest-labs/flux-2-klein-9b-base', provider: 'puter', group: '开源模型', groupIcon: '🆓',
      name: 'Flux 2 Klein 9B', desc: '轻量开源 (Replicate)', status: 'exhausted', statusReason: 'Replicate 免费额度已用完',
      maxResolution: 1024, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://replicate.com/black-forest-labs/flux-2-klein-9b-base', websiteLabel: 'Replicate'
    },
    {
      id: 'leonardoai/phoenix-1.0', provider: 'puter', group: '开源模型', groupIcon: '🆓',
      name: 'Leonardo Phoenix', desc: '风格化开源', status: 'exhausted', statusReason: 'Replicate 免费额度已用完',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://leonardo.ai/', websiteLabel: 'Leonardo'
    },
    {
      id: 'leonardoai/lucid-origin', provider: 'puter', group: '开源模型', groupIcon: '🆓',
      name: 'Leonardo Lucid Origin', desc: '梦幻风格', status: 'exhausted', statusReason: 'Replicate 免费额度已用完',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'free', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://leonardo.ai/', websiteLabel: 'Leonardo'
    },
    {
      id: 'Qwen/Qwen-Image', provider: 'puter', group: '开源模型', groupIcon: '🆓',
      name: 'Qwen Image', desc: '阿里通义 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1328, h: 1328 },
      qualityMode: 'replicate', pricing: 'free', region: 'china',
      widthMultipleOf: 8, isRatioOnly: false,
      website: 'https://tongyi.aliyun.com/', websiteLabel: '通义千问'
    },
    {
      id: 'ByteDance-Seed/Seedream-4.0', provider: 'puter', group: '开源模型', groupIcon: '🆓',
      name: 'Seedream 4.0', desc: '字节最新 (Replicate)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'free', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://jimeng.jianying.com/', websiteLabel: '即梦AI'
    },

    // ────────── Puter.js — xAI / Grok ──────────
    {
      id: 'grok-2-image', provider: 'puter', group: 'xAI', groupIcon: '🚀',
      name: 'Grok 2 Image', desc: 'xAI原生', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://x.ai/', websiteLabel: 'xAI'
    },

    // ────────── Puter.js — Flux 2 系列 (Together AI) ──────────
    {
      id: 'black-forest-labs/FLUX.2-pro', provider: 'puter', group: 'Flux 2', groupIcon: '🌪️',
      name: 'FLUX.2 Pro', desc: '最新旗舰 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },
    {
      id: 'black-forest-labs/FLUX.2-dev', provider: 'puter', group: 'Flux 2', groupIcon: '🌪️',
      name: 'FLUX.2 Dev', desc: '开发版 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },
    {
      id: 'black-forest-labs/FLUX.2-flex', provider: 'puter', group: 'Flux 2', groupIcon: '🌪️',
      name: 'FLUX.2 Flex', desc: '灵活版 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },
    {
      id: 'black-forest-labs/FLUX.2-max', provider: 'puter', group: 'Flux 2', groupIcon: '🌪️',
      name: 'FLUX.2 Max', desc: '极致版 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },

    // ────────── Puter.js — Flux Kontext (Together AI) ──────────
    {
      id: 'black-forest-labs/FLUX.1-kontext-pro', provider: 'puter', group: 'Flux Kontext', groupIcon: '🖼️',
      name: 'FLUX.1 Kontext Pro', desc: '上下文编辑 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },
    {
      id: 'black-forest-labs/FLUX.1-kontext-max', provider: 'puter', group: 'Flux Kontext', groupIcon: '🖼️',
      name: 'FLUX.1 Kontext Max', desc: '极致编辑 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1440, h: 1440 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL'
    },

    // ────────── Puter.js — Juggernaut (Together AI) ──────────
    {
      id: 'RunDiffusion/Juggernaut-pro-flux', provider: 'puter', group: 'Juggernaut', groupIcon: '⚡',
      name: 'Juggernaut Pro Flux', desc: '专业写实 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://rundiffusion.com/', websiteLabel: 'RunDiffusion'
    },
    {
      id: 'Rundiffusion/Juggernaut-Lightning-Flux', provider: 'puter', group: 'Juggernaut', groupIcon: '⚡',
      name: 'Juggernaut Lightning', desc: '极速写实 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://rundiffusion.com/', websiteLabel: 'RunDiffusion'
    },

    // ────────── Puter.js — Qwen Image 2 (Together AI) ──────────
    {
      id: 'Qwen/Qwen-Image-2.0', provider: 'puter', group: 'Qwen 2', groupIcon: '🧧',
      name: 'Qwen Image 2.0', desc: '通义新一代 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1328, h: 1328 },
      qualityMode: 'replicate', pricing: 'paid', region: 'china',
      widthMultipleOf: 8, isRatioOnly: false,
      website: 'https://tongyi.aliyun.com/', websiteLabel: '通义千问'
    },
    {
      id: 'Qwen/Qwen-Image-2.0-Pro', provider: 'puter', group: 'Qwen 2', groupIcon: '🧧',
      name: 'Qwen Image 2.0 Pro', desc: '通义专业版 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1328, h: 1328 },
      qualityMode: 'replicate', pricing: 'paid', region: 'china',
      widthMultipleOf: 8, isRatioOnly: false,
      website: 'https://tongyi.aliyun.com/', websiteLabel: '通义千问'
    },

    // ────────── Puter.js — Ideogram 3/4 (Together AI) ──────────
    {
      id: 'ideogram/ideogram-3.0', provider: 'puter', group: 'Ideogram', groupIcon: '✍️',
      name: 'Ideogram 3.0', desc: '文字渲染 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://ideogram.ai/', websiteLabel: 'Ideogram'
    },
    {
      id: 'ideogram/ideogram-4.0', provider: 'puter', group: 'Ideogram', groupIcon: '✍️',
      name: 'Ideogram 4.0', desc: '最新排印 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://ideogram.ai/', websiteLabel: 'Ideogram'
    },

    // ────────── Puter.js — Seedream 3/5 (Together AI) ──────────
    {
      id: 'ByteDance-Seed/Seedream-3.0', provider: 'puter', group: 'Seedream', groupIcon: '🌱',
      name: 'Seedream 3.0', desc: '字节经典 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://jimeng.jianying.com/', websiteLabel: '即梦AI'
    },
    {
      id: 'ByteDance/Seedream-5.0-lite', provider: 'puter', group: 'Seedream', groupIcon: '🌱',
      name: 'Seedream 5.0 Lite', desc: '最新搜索推理 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://jimeng.jianying.com/', websiteLabel: '即梦AI'
    },

    // ────────── Puter.js — Wan & Others (Together AI) ──────────
    {
      id: 'Wan-AI/Wan2.6-image', provider: 'puter', group: 'Wan', groupIcon: '🎬',
      name: 'Wan 2.6 Image', desc: '阿里最新 (Together)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'china',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://tongyi.aliyun.com/wanxiang', websiteLabel: '通义万相'
    },

    // ────────── Puter.js — More Google (Together AI) ──────────
    {
      id: 'google/flash-image-3.1', provider: 'puter', group: 'Google', groupIcon: '🔮',
      name: 'Gemini 3.1 Flash Image', desc: '最新 (Together)', status: 'active',
      maxResolution: 4096, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'google', pricing: 'paid', region: 'us',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://aistudio.google.com/', websiteLabel: 'AI Studio'
    },

    // ────────── Puter.js — SD 3.5 (Replicate) ──────────
    {
      id: 'stabilityai/stable-diffusion-3.5-large', provider: 'puter', group: 'Stable Diffusion', groupIcon: '🎨',
      name: 'SD 3.5 Large', desc: '最新开源 (Replicate)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://stability.ai/', websiteLabel: 'Stability AI'
    },
    {
      id: 'stabilityai/stable-diffusion-3.5-medium', provider: 'puter', group: 'Stable Diffusion', groupIcon: '🎨',
      name: 'SD 3.5 Medium', desc: '轻量开源 (Replicate)', status: 'active',
      maxResolution: 2048, nativeSize: { w: 1024, h: 1024 },
      qualityMode: 'replicate', pricing: 'paid', region: 'global',
      widthMultipleOf: null, isRatioOnly: false,
      website: 'https://stability.ai/', websiteLabel: 'Stability AI'
    },
  ];

  // ======================== 运行时状态 ========================
  const STORAGE_KEY = 'model_registry_status';
  const STORAGE_KEY_USER_MODELS = 'model_registry_user_models';
  const STORAGE_KEY_EDITS = 'model_registry_edits';
  const STORAGE_KEY_DELETED = 'model_registry_deleted';

  let _statusMap = {};       // { modelId: { exhausted, reason, lastChecked } }
  let _userModels = [];      // 用户手动添加的模型
  let _modelEdits = {};      // { modelId: { ...字段覆盖 } } — 用户编辑的字段
  let _deletedIds = new Set(); // 用户删除的模型 ID

  function _loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function _saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function loadStatus() { _statusMap = _loadJson(STORAGE_KEY, {}); }
  function saveStatus() { _saveJson(STORAGE_KEY, _statusMap); }

  function loadRuntimeData() {
    _userModels = _loadJson(STORAGE_KEY_USER_MODELS, []);
    _modelEdits = _loadJson(STORAGE_KEY_EDITS, {});
    _deletedIds = new Set(_loadJson(STORAGE_KEY_DELETED, []));
  }

  function saveRuntimeData() {
    _saveJson(STORAGE_KEY_USER_MODELS, _userModels);
    _saveJson(STORAGE_KEY_EDITS, _modelEdits);
    _saveJson(STORAGE_KEY_DELETED, Array.from(_deletedIds));
  }

  // 初始化：从 MODELS 中合并初始状态
  function initStatus() {
    loadStatus();
    loadRuntimeData();
    MODELS.forEach(m => {
      if (m.status !== 'active' && !_statusMap[m.id]) {
        _statusMap[m.id] = {
          exhausted: m.status === 'exhausted',
          reason: m.statusReason || '',
          lastChecked: null
        };
      }
    });
    saveStatus();
  }

  // ======================== 公开 API ========================

  function resolveStatus(model) {
    const runtime = _statusMap[model.id];
    if (runtime && runtime.exhausted) {
      return { status: 'exhausted', reason: runtime.reason || '额度已耗尽' };
    }
    if (model.status === 'offline') {
      return { status: 'offline', reason: model.statusReason || '模型已下线' };
    }
    return { status: 'active', reason: '' };
  }

  // 应用编辑覆盖字段
  function applyEdits(model) {
    const edits = _modelEdits[model.id];
    if (!edits) return model;
    return { ...model, ...edits };
  }

  const PERM_BLACKLIST_KEY = 'model_registry_perm_blacklist';
  let _permBlacklist = new Set();

  function getPermBlacklist() {
    return new Set(_loadJson(PERM_BLACKLIST_KEY, []));
  }

  return {
    /** 获取所有模型（合并静态定义 + 用户编辑 + 用户添加 - 已删除 - 永久黑名单） */
    getAll() {
      const blacklist = getPermBlacklist();
      // 1. 静态模型（应用编辑 + 排除已删除/黑名单 + 合并运行时状态）
      const staticModels = MODELS
        .filter(m => !_deletedIds.has(m.id) && !blacklist.has(m.id))
        .map(m => {
          const edited = applyEdits(m);
          const s = resolveStatus(edited);
          return { ...edited, status: s.status, statusReason: s.reason, _source: 'builtin' };
        });

      // 2. 用户添加的模型（排除已删除 + 合并运行时状态）
      const userModels = _userModels
        .filter(m => !_deletedIds.has(m.id))
        .map(m => {
          const s = resolveStatus(m);
          return { ...m, status: s.status, statusReason: s.reason, _source: 'user' };
        });

      return [...staticModels, ...userModels];
    },

    /** 获取所有可用模型（status === 'active'） */
    getActive() {
      return this.getAll().filter(m => m.status === 'active');
    },

    /** 按 provider 过滤 */
    getByProvider(provider) {
      return this.getAll().filter(m => m.provider === provider);
    },

    /** 获取单个模型（同时查询静态和用户模型） */
    get(modelId) {
      const m = MODELS.find(m => m.id === modelId) || _userModels.find(m => m.id === modelId);
      if (!m) return null;
      const edited = applyEdits(m);
      const s = resolveStatus(edited);
      return { ...edited, status: s.status, statusReason: s.reason, _source: MODELS.some(x => x.id === modelId) ? 'builtin' : 'user' };
    },

    /** 获取模型最大分辨率 */
    getMaxResolution(modelId) {
      const m = this.get(modelId);
      return m ? m.maxResolution : 2048;
    },

    /** 获取模型原生尺寸 */
    getNativeSize(modelId) {
      const m = this.get(modelId);
      return m ? { width: m.nativeSize.w, height: m.nativeSize.h } : { width: 1024, height: 1024 };
    },

    /** 获取画质参数映射 */
    getQualityParams(modelId, qualityLevel) {
      const m = this.get(modelId);
      if (!m || m.qualityMode === 'none') return null;

      const opts = {};
      switch (m.qualityMode) {
        case 'openai-gpt2':
          opts.quality = qualityLevel === 'fast' ? 'low' : qualityLevel === 'standard' ? 'medium' : 'auto';
          break;
        case 'openai':
          opts.quality = qualityLevel === 'fast' ? 'low' : qualityLevel === 'standard' ? 'medium' : 'high';
          break;
        case 'dalle':
          opts.quality = qualityLevel === 'high' ? 'hd' : 'standard';
          break;
        case 'google':
        case 'replicate':
        default:
          opts.quality = qualityLevel === 'fast' ? 'low' : qualityLevel === 'standard' ? 'medium' : 'high';
          break;
      }
      return Object.keys(opts).length > 0 ? opts : null;
    },

    /** 获取宽度对齐倍数 */
    getWidthMultipleOf(modelId) {
      const m = this.get(modelId);
      return m ? m.widthMultipleOf : null;
    },

    /** 是否仅支持比例 */
    isRatioOnly(modelId) {
      const m = this.get(modelId);
      return m ? m.isRatioOnly : false;
    },

    /** 标记模型为已耗尽/不可用 */
    markExhausted(modelId, reason) {
      _statusMap[modelId] = {
        exhausted: true,
        reason: reason || '额度已耗尽',
        lastChecked: new Date().toISOString()
      };
      saveStatus();
      console.warn(`[ModelRegistry] ${modelId} → 已标记: ${reason}`);
    },

    /** 清除模型状态（重新启用） */
    clearStatus(modelId) {
      delete _statusMap[modelId];
      saveStatus();
      console.log(`[ModelRegistry] ${modelId} → 状态已清除`);
    },

    /** 获取运行时状态映射 */
    getStatusMap() {
      return { ..._statusMap };
    },

    /** 重置所有状态 */
    resetAllStatus() {
      _statusMap = {};
      saveStatus();
    },

    // ==================== 运行时 CRUD（界面管理） ====================

    /** 添加新模型（持久化到 localStorage） */
    addModel(modelData) {
      const newModel = {
        id: modelData.id,
        provider: modelData.provider || 'pollinations',
        group: modelData.group || '自定义',
        groupIcon: modelData.groupIcon || '✨',
        name: modelData.name || '未命名',
        desc: modelData.desc || '',
        status: 'active',
        maxResolution: modelData.maxResolution || 1024,
        nativeSize: modelData.nativeSize || { w: 1024, h: 1024 },
        qualityMode: modelData.qualityMode || 'none',
        pricing: modelData.pricing || 'free',
        region: modelData.region || 'global',
        widthMultipleOf: modelData.widthMultipleOf || null,
        isRatioOnly: modelData.isRatioOnly || false,
        website: modelData.website || '',
        websiteLabel: modelData.websiteLabel || modelData.name || ''
      };
      _userModels.push(newModel);
      saveRuntimeData();
      return newModel;
    },

    /** 更新模型字段（支持内置和用户模型） */
    updateModel(modelId, updates) {
      // 检查是否是用户模型
      const userIdx = _userModels.findIndex(m => m.id === modelId);
      if (userIdx >= 0) {
        _userModels[userIdx] = { ..._userModels[userIdx], ...updates };
        saveRuntimeData();
        return _userModels[userIdx];
      }
      // 内置模型：存入编辑映射
      if (!_modelEdits[modelId]) _modelEdits[modelId] = {};
      _modelEdits[modelId] = { ..._modelEdits[modelId], ...updates };
      saveRuntimeData();
      return { ...MODELS.find(m => m.id === modelId), ..._modelEdits[modelId] };
    },

    /** 删除模型（标记删除，不物理移除） */
    deleteModel(modelId) {
      _deletedIds.add(modelId);
      // 同时从 userModels 和 edits 中移除
      _userModels = _userModels.filter(m => m.id !== modelId);
      delete _modelEdits[modelId];
      saveRuntimeData();
    },

    /** 获取所有未删除的模型 ID */
    getDeletedIds() { return new Set(_deletedIds); },

    /** 检查是否被删除 */
    isDeleted(modelId) { return _deletedIds.has(modelId); },

    /** 撤销删除 */
    restoreModel(modelId) {
      _deletedIds.delete(modelId);
      saveRuntimeData();
    },

    /** 永久删除（加入黑名单，不可恢复） */
    permanentDelete(modelId) {
      _deletedIds.delete(modelId);
      _saveJson(STORAGE_KEY_DELETED, Array.from(_deletedIds));
      // 添加到永久黑名单
      const blacklist = _loadJson('model_registry_perm_blacklist', []);
      if (!blacklist.includes(modelId)) {
        blacklist.push(modelId);
        _saveJson('model_registry_perm_blacklist', blacklist);
      }
      delete _modelEdits[modelId];
      _saveJson(STORAGE_KEY_EDITS, _modelEdits);
    },

    /** 获取已删除的模型列表（用于恢复） */
    getDeletedModels() {
      const blacklist = getPermBlacklist();
      const result = [];
      _deletedIds.forEach(id => {
        if (blacklist.has(id)) return; // 永久删除的不显示
        const builtin = MODELS.find(m => m.id === id);
        if (builtin) {
          const edited = applyEdits(builtin);
          result.push({ ...edited, status: 'offline', statusReason: '已删除', _source: 'builtin' });
        }
      });
      return result;
    },

    /** 获取用户的编辑映射（用于查看当前修改） */
    getEdits() { return { ..._modelEdits }; },

    // ==================== 智能刷新（联网查询） ====================

    /** 已知 Pollinations 模型元数据映射（id -> 补充属性） */
    _KNOWN_POLLINATIONS: {
      'flux': { name: 'Flux Schnell', desc: '默认推荐', maxResolution: 1440, nativeSize: { w: 1024, h: 1024 }, website: 'https://pollinations.ai/', websiteLabel: 'Pollinations' },
      'turbo': { name: 'Turbo', desc: '旧版极速', maxResolution: 1024, nativeSize: { w: 1024, h: 1024 }, website: 'https://pollinations.ai/', websiteLabel: 'Pollinations' },
      'zimage': { name: 'Z-Image Turbo', desc: '极速生成', maxResolution: 1440, nativeSize: { w: 1024, h: 1024 }, website: 'https://zimage.design/', websiteLabel: 'Z Image' },
      'seedream': { name: 'Seedream 4.0', desc: '创意风格', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://seedream.art/', websiteLabel: 'Seedream' },
      'sana': { name: 'Sana', desc: '原生1:1', maxResolution: 1024, nativeSize: { w: 1024, h: 1024 }, website: 'https://github.com/NVlabs/Sana', websiteLabel: 'GitHub' },
      'klein': { name: 'FLUX.2 Klein 4B', desc: '最新轻量', maxResolution: 1440, nativeSize: { w: 1024, h: 1024 }, website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL' },
      'qwen-image': { name: 'Qwen Image Plus', desc: '通义千问', maxResolution: 2048, nativeSize: { w: 1328, h: 1328 }, website: 'https://tongyi.aliyun.com/', websiteLabel: '通义千问', region: 'china' },
      'grok-imagine': { name: 'Grok Imagine', desc: 'xAI 出品', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://x.ai/', websiteLabel: 'xAI' },
      'ideogram-v4-turbo': { name: 'Ideogram 4.0 Turbo', desc: '文字渲染', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://ideogram.ai/', websiteLabel: 'Ideogram' },
      'nanobanana': { name: 'NanoBanana', desc: '轻量免费', maxResolution: 1024, nativeSize: { w: 512, h: 512 }, website: 'https://pollinations.ai/', websiteLabel: 'Pollinations' },
      'nanobanana-pro': { name: 'NanoBanana Pro', desc: '增强免费', maxResolution: 1024, nativeSize: { w: 512, h: 512 }, website: 'https://pollinations.ai/', websiteLabel: 'Pollinations' },
      'nanobanana-2': { name: 'NanoBanana 2', desc: '细节增强', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://pollinations.ai/', websiteLabel: 'Pollinations' },
      'kontext': { name: 'FLUX.1 Kontext', desc: '上下文编辑', maxResolution: 1440, nativeSize: { w: 1024, h: 1024 }, website: 'https://blackforestlabs.ai/', websiteLabel: 'BFL' },
      'gptimage': { name: 'GPT Image 1 Mini', desc: '快速经济', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://openai.com/', websiteLabel: 'OpenAI' },
      'gptimage-large': { name: 'GPT Image 1.5', desc: '高保真编辑', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://openai.com/', websiteLabel: 'OpenAI' },
      'seedream5': { name: 'Seedream 5.0 Lite', desc: '搜索推理', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://seedream.art/', websiteLabel: 'Seedream' },
      'seedream-pro': { name: 'Seedream 4.5 Pro', desc: '高级照片级', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://seedream.art/', websiteLabel: 'Seedream' },
      'ideogram-v4-balanced': { name: 'Ideogram 4.0 Balanced', desc: '均衡排印', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://ideogram.ai/', websiteLabel: 'Ideogram' },
      'ideogram-v4-quality': { name: 'Ideogram 4.0 Quality', desc: '高保真排印', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://ideogram.ai/', websiteLabel: 'Ideogram' },
      'wan-image': { name: 'Wan 2.7 Image', desc: '阿里文生图', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://tongyi.aliyun.com/wanxiang', websiteLabel: '通义万相', region: 'china' },
      'wan-image-pro': { name: 'Wan 2.7 Image Pro', desc: '阿里4K增强', maxResolution: 4096, nativeSize: { w: 1024, h: 1024 }, website: 'https://tongyi.aliyun.com/wanxiang', websiteLabel: '通义万相', region: 'china' },
      'grok-imagine-pro': { name: 'Grok Imagine Pro', desc: 'xAI Aurora增强', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://x.ai/', websiteLabel: 'xAI' },
      'p-image': { name: 'Pruna P-Image', desc: '快速文生图', maxResolution: 1024, nativeSize: { w: 1024, h: 1024 }, website: 'https://pruna.ai/', websiteLabel: 'Pruna' },
      'p-image-edit': { name: 'Pruna P-Image Edit', desc: '图生图编辑', maxResolution: 1024, nativeSize: { w: 1024, h: 1024 }, website: 'https://pruna.ai/', websiteLabel: 'Pruna' },
      'nova-canvas': { name: 'Nova Canvas', desc: 'Amazon生成', maxResolution: 2048, nativeSize: { w: 1024, h: 1024 }, website: 'https://aws.amazon.com/nova/', websiteLabel: 'AWS Nova' },
      'stable-diffusion': { name: 'Stable Diffusion', desc: '经典SD', maxResolution: 1024, nativeSize: { w: 1024, h: 1024 }, website: 'https://stability.ai/', websiteLabel: 'Stability AI' },
    },

    /**
     * 从网络刷新模型库 — 异步，返回报告 { added, markedOffline, restored, probed, probedOk, probedFail, errors }
     * 策略：
     *  1. 从 Pollinations /models 端点发现新模型名（补充发现）
     *  2. 逐个探测所有 Pollinations 模型 → 不可用的标记为 exhausted，可用的恢复
     *  3. Puter.js 模型跳过（无法轻量探测）
     * @param {Function} onProgress - 可选回调 (phase, detail) => void
     */
    async refreshFromUpstream(onProgress) {
      const report = { added: [], markedOffline: [], restored: [], probed: 0, probedOk: 0, probedFail: 0, errors: [] };

      // ============ Phase 1: 获取 Pollinations 模型列表（用于发现新模型） ============
      onProgress && onProgress('fetch', '正在获取 Pollinations 模型列表...');
      let upstreamNames = [];
      try {
        const resp = await fetch('/api/pollinations-models');
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) upstreamNames = data.map(s => (s || '').toString().toLowerCase().trim()).filter(Boolean);
        }
      } catch (e) {
        report.errors.push(`获取模型列表失败: ${e.message}`);
      }
      const upstreamSet = new Set(upstreamNames);

      // ============ Phase 2: 收集所有需要探测的模型名 ============
      const currentPollinations = MODELS.filter(m => m.provider === 'pollinations' && !getPermBlacklist().has(m.id));
      const currentIds = new Set(currentPollinations.map(m => m.id.toLowerCase()));

      // 合并：现有 + 上游新发现的
      const toProbe = new Set();
      currentPollinations.forEach(m => toProbe.add(m.id));
      upstreamSet.forEach(name => { if (!currentIds.has(name) && !_deletedIds.has(name)) toProbe.add(name); });

      if (toProbe.size === 0) {
        onProgress && onProgress('done', '无需探测');
        return report;
      }

      onProgress && onProgress('probe', `正在探测 ${toProbe.size} 个模型...`);

      // ============ Phase 3: 逐个探测 ============
      const probeResults = {}; // modelId → { available: bool, error: string }
      const modelNames = Array.from(toProbe);

      // 并发探测（限制并发 4 个，避免打爆）
      const CONCURRENCY = 4;
      for (let i = 0; i < modelNames.length; i += CONCURRENCY) {
        if (onProgress && typeof window !== 'undefined' && window._refreshAborted) {
          report.errors.push('用户取消');
          return report;
        }
        const batch = modelNames.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (modelId) => {
            try {
              const resp = await fetch(`/api/probe-model?model=${encodeURIComponent(modelId)}`);
              if (!resp.ok) return { modelId, available: false, error: `HTTP ${resp.status}` };
              const data = await resp.json();
              return { modelId, available: data.available, error: data.error || (data.available ? null : `HTTP ${data.status}`) };
            } catch (e) {
              return { modelId, available: false, error: e.message };
            }
          })
        );

        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            probeResults[r.value.modelId] = { available: r.value.available, error: r.value.error };
          } else {
            const mid = batch[idx];
            probeResults[mid] = { available: false, error: '探测连接失败' };
          }
          report.probed++;
        });

        onProgress && onProgress('probe', `已探测 ${Math.min(i + CONCURRENCY, modelNames.length)}/${modelNames.length}...`);
      }

      // 统计
      report.probedOk = Object.values(probeResults).filter(r => r.available).length;
      report.probedFail = Object.values(probeResults).filter(r => !r.available).length;

      // ============ Phase 4: 应用结果 — 下线不可用的 ============
      currentPollinations.forEach(m => {
        const result = probeResults[m.id];
        if (!result) return;
        if (!result.available) {
          // 不可用 → 标记为 exhausted
          const reason = `探测失败: ${result.error || '未知错误'}`;
          this.markExhausted(m.id, reason);
          report.markedOffline.push({ id: m.id, name: m.name, error: result.error });
        } else if (_statusMap[m.id] && _statusMap[m.id].exhausted) {
          // 恢复可用
          this.clearStatus(m.id);
          report.restored.push({ id: m.id, name: m.name });
        }
      });

      // ============ Phase 5: 添加新发现的可用模型 ============
      for (const modelName of upstreamSet) {
        if (currentIds.has(modelName)) continue;   // 已存在
        if (_deletedIds.has(modelName)) continue;   // 被用户删除
        const result = probeResults[modelName];
        if (!result || !result.available) continue; // 不可用则跳过

        const known = this._KNOWN_POLLINATIONS[modelName] || {};
        const modelDef = {
          id: modelName,
          provider: 'pollinations',
          group: known.group || 'Pollinations',
          groupIcon: known.groupIcon || '📡',
          name: known.name || modelName.charAt(0).toUpperCase() + modelName.slice(1).replace(/-/g, ' '),
          desc: known.desc || '自动发现',
          status: 'active',
          maxResolution: known.maxResolution || 1440,
          nativeSize: known.nativeSize || { w: 1024, h: 1024 },
          qualityMode: known.qualityMode || 'none',
          pricing: known.pricing || 'free',
          region: known.region || 'global',
          widthMultipleOf: known.widthMultipleOf || null,
          isRatioOnly: known.isRatioOnly || false,
          website: known.website || 'https://pollinations.ai/',
          websiteLabel: known.websiteLabel || 'Pollinations',
        };
        this.addModel(modelDef);
        report.added.push({ id: modelName, name: modelDef.name });
      }

      saveRuntimeData();
      saveStatus();
      onProgress && onProgress('done', `完成：可用 ${report.probedOk} · 不可用 ${report.probedFail}`);
      return report;
    },

    /** 按分组整理（用于生成 UI） */
    getGrouped(onlyActive = true) {
      const models = onlyActive ? this.getActive() : this.getAll();
      const groups = {};
      models.forEach(m => {
        const key = m.group;
        if (!groups[key]) groups[key] = { icon: m.groupIcon, models: [] };
        groups[key].models.push(m);
      });
      return groups;
    },

    /** 初始化（页面加载时调用一次） */
    init() {
      initStatus();
    }
  };
})();

// Node.js 环境兼容
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModelRegistry;
}
