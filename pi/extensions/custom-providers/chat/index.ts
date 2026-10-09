import type { ModalityProvidersRecord } from "../types.ts";
import {
  OMNIROUTE_MODELS,
  SHUAIAPI_MODELS,
  BIGMODEL_MODELS,
  DASHSCOPE_CHAT_MODELS,
} from "./models.ts";

const OMNIROUTE_BASE_URL = "http://192.168.22.172:20128/v1";
const SHUAIAPI_BASE_URL = "https://cdn.shuaiapi.com/v1";
const BIGMODEL_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export const chatProviders: ModalityProvidersRecord = {
  omniroute: {
    name: "OmniRoute",
    baseUrl: OMNIROUTE_BASE_URL,
    api: "openai-completions",
    models: OMNIROUTE_MODELS,
  },
  shuaiapi: {
    name: "SHUAI API",
    baseUrl: SHUAIAPI_BASE_URL,
    api: "openai-completions",
    models: SHUAIAPI_MODELS,
  },
  bigmodel: {
    name: "BigModel (智谱)",
    baseUrl: BIGMODEL_BASE_URL,
    api: "openai-completions",
    models: BIGMODEL_MODELS,
  },
  dashscope: {
    name: "Aliyun DashScope (阿里百炼)",
    baseUrl: DASHSCOPE_BASE_URL,
    api: "openai-completions",
    models: DASHSCOPE_CHAT_MODELS,
  },
};
