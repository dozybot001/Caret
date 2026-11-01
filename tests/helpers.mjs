// 多个测试共用的内存工作区、模型和存储
import { executeTool } from '../src/agent/tools.js';

/** 内存工作区 */
export function workspace(files = {}) {
    const state = new Map(Object.entries(files));
    return {
        name: 'demo',
        state,
        async refresh() {},
        paths: () => [...state.keys()],
        isDirectory: path => [...state.keys()].some(file => file.startsWith(`${path}/`)),
        getText: async path => (state.has(path) ? { text: state.get(path) } : null),
        setText: async (path, text) => void state.set(path, text)
    };
}

export const run = (ws, name, args) => executeTool(ws, name, args);

/** 按脚本回复的模型服务 */
export function scriptedModel(replies) {
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push(JSON.parse(options.body));
        const reply = replies.shift();
        if (reply.status) return new Response(JSON.stringify({ error: { message: reply.message } }), { status: reply.status });
        const delta = reply.tool
            ? { tool_calls: [{ index: 0, id: `call_${requests.length}`, function: { name: reply.tool, arguments: reply.raw ?? JSON.stringify(reply.args) } }] }
            : { content: reply.text };
        const finish = reply.finish ? `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reply.finish }] })}\n\n` : '';
        return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n${finish}data: [DONE]\n\n`);
    };
    return requests;
}

export const connection = () => ({ url: 'https://model.test/v1', key: 'test', model: 'm' });

/** 内存存储 */
export function memoryStore() {
    const projects = new Map();
    const sessions = new Map();
    const data = new Map();
    return {
        data,
        listProjects: async () => [...projects.values()],
        saveProject: async project => void projects.set(project.id, project),
        listSessions: async () => [...sessions.values()],
        getSessionData: async id => data.get(id),
        saveSession: async (session, content) => {
            sessions.set(session.id, session);
            data.set(session.id, structuredClone(content));
        },
        deleteSessions: async ids => ids.forEach(id => {
            sessions.delete(id);
            data.delete(id);
        }),
        clearConversations: async () => {
            sessions.clear();
            data.clear();
            projects.forEach((project, id) => projects.set(id, { ...project, prompts: [] }));
        }
    };
}

export const folder = (name, id = name) => ({ name, id, isSameEntry: async other => other.id === id });
