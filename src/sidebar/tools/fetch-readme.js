/**
 * @fileoverview Fetch README 功能模块
 * @description 从 GitHub 获取所有公共仓库的 README 文件并打包下载
 * @module sidebar/tools/fetch-readme
 */

/**
 * Fetch README 功能模块
 * @class FetchReadmeFeature
 */
export class FetchReadmeFeature {
    /**
     * @param {Object} context - 功能模块上下文
     * @param {Object} context.store - 状态存储实例
     */
    constructor(context) {
        this.context = context;
    }

    /**
     * 执行功能
     * @param {string} githubUrl - GitHub URL (用户或组织)
     * @returns {Promise<void>}
     */
    async execute(githubUrl) {
        if (!githubUrl || !githubUrl.trim()) {
            throw new Error('Please enter a GitHub URL');
        }

        const { owner } = this._parseGitHubUrl(githubUrl);
        if (!owner) {
            throw new Error('Invalid GitHub URL. Please enter a user or organization URL (e.g., https://github.com/username)');
        }

        if (window.notify) {
            window.notify.alert(`Fetching repositories for ${owner}...`, { type: 'info', duration: 2000 });
        }

        try {
            const repos = await this._fetchPublicRepositories(owner);
            if (repos.length === 0) {
                if (window.notify) {
                    window.notify.alert(`No public repositories found for ${owner}`, { type: 'warning' });
                }
                return;
            }

            if (window.notify) {
                window.notify.alert(`Found ${repos.length} repositories. Fetching READMEs...`, { type: 'info', duration: 2000 });
            }

            const readmes = await this._fetchAllReadmes(repos);
            if (readmes.length === 0) {
                if (window.notify) {
                    window.notify.alert(`No README files found in ${repos.length} repositories`, { type: 'warning' });
                }
                return;
            }

            await this._createAndDownloadZip(readmes, owner);

            if (window.notify) {
                window.notify.alert(`Successfully downloaded ${readmes.length} README files`, { type: 'success' });
            }
        } catch (error) {
            const msg = error.message || 'Failed to fetch READMEs';
            if (window.notify) {
                window.notify.alert(msg, { type: 'error', duration: 5000 });
            }
            throw error;
        }
    }

    /**
     * Decode base64 content to UTF-8 string
     * @private
     * @param {string} base64 - Base64 encoded string
     * @returns {string} Decoded UTF-8 string
     */
    _decodeBase64ToUTF8(base64) {
        // Remove all whitespace (including newlines) before decoding
        const cleanBase64 = base64.replace(/\s/g, '');
        
        // Decode base64 to binary string
        const binaryString = atob(cleanBase64);
        
        // Convert binary string to UTF-8
        // Handle UTF-8 encoding properly for multi-byte characters
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Use TextDecoder to properly decode UTF-8
        try {
            const decoder = new TextDecoder('utf-8');
            return decoder.decode(bytes);
        } catch (e) {
            // Fallback to direct string if TextDecoder fails
            return binaryString;
        }
    }

    /**
     * @private
     * @param {string} url
     * @returns {{owner: string|null, type: 'user'|'org'|null}}
     */
    _parseGitHubUrl(url) {
        const t = url.trim();
        const userOrOrg = t.match(/^https?:\/\/github\.com\/([^\/\s]+)\/?$/);
        if (userOrOrg) return { owner: userOrOrg[1], type: 'user' };
        const repo = t.match(/^https?:\/\/github\.com\/([^\/\s]+)\//);
        if (repo) return { owner: repo[1], type: 'user' };
        return { owner: null, type: null };
    }

    /**
     * @private
     * @param {string} owner
     * @returns {Promise<Array<{name: string, full_name: string}>>}
     */
    async _fetchPublicRepositories(owner) {
        const repos = [];
        let page = 1;
        const perPage = 100;

        for (;;) {
            const res = await fetch(
                `https://api.github.com/users/${owner}/repos?type=public&per_page=${perPage}&page=${page}&sort=updated`,
                { headers: { Accept: 'application/vnd.github.v3+json' } }
            );

            if (!res.ok) {
                if (res.status === 404) throw new Error(`User or organization "${owner}" not found`);
                if (res.status === 403) {
                    if (res.headers.get('X-RateLimit-Remaining') === '0') {
                        throw new Error('GitHub API rate limit exceeded. Please try again later.');
                    }
                    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
                }
                throw new Error(`Failed to fetch repositories: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) break;

            repos.push(...data.map((r) => ({ name: r.name, full_name: r.full_name })));
            if (data.length < perPage) break;
            page++;
        }

        return repos;
    }

    /**
     * @private
     * @param {Array<{name: string, full_name: string}>} repos
     * @returns {Promise<Array<{repo: string, full_name: string, content: string, filename: string}>>}
     */
    async _fetchAllReadmes(repos) {
        const readmes = [];
        const names = ['README.md', 'README.txt', 'README', 'readme.md', 'readme.txt', 'readme'];
        const concurrency = 5;

        for (let i = 0; i < repos.length; i += concurrency) {
            const batch = repos.slice(i, i + concurrency);
            const results = await Promise.all(
                batch.map(async (repo) => {
                    for (const name of names) {
                        try {
                            const res = await fetch(
                                `https://api.github.com/repos/${repo.full_name}/contents/${name}`,
                                { headers: { Accept: 'application/vnd.github.v3+json' } }
                            );
                            if (!res.ok) {
                                if (res.status === 404) continue;
                                if (res.status === 403) {
                                    console.warn(`Skipping ${repo.full_name}: ${res.statusText}`);
                                    return null;
                                }
                                continue;
                            }
                            {
                                const d = await res.json();
                                if (d.type === 'file' && d.content) {
                                    // GitHub API returns base64 content, decode it properly
                                    let decodedContent;
                                    try {
                                        decodedContent = this._decodeBase64ToUTF8(d.content);
                                    } catch (e) {
                                        console.warn(`Failed to decode base64 for ${repo.full_name}/${name}:`, e);
                                        continue;
                                    }
                                    return {
                                        repo: repo.name,
                                        full_name: repo.full_name,
                                        content: decodedContent,
                                        filename: name
                                    };
                                }
                            }
                        } catch (e) {
                            console.warn(`Error fetching README for ${repo.full_name}:`, e);
                            return null;
                        }
                    }
                    return null;
                })
            );
            readmes.push(...results.filter(Boolean));
            if (i + concurrency < repos.length) {
                await new Promise((r) => setTimeout(r, 200));
            }
        }

        return readmes;
    }

    /**
     * @private
     * @param {Array<{repo: string, full_name: string, content: string, filename: string}>} readmes
     * @param {string} owner
     * @returns {Promise<void>}
     */
    async _createAndDownloadZip(readmes, owner) {
        const JSZipLib = typeof window !== 'undefined' && window.JSZip ? window.JSZip : typeof JSZip !== 'undefined' ? JSZip : null;
        if (!JSZipLib) throw new Error('JSZip library is not loaded. Please refresh the page.');

        const zip = new JSZipLib();
        
        // Add README files directly to root (no folders), renamed with project name
        readmes.forEach(({ repo, content, filename }) => {
            // Rename: project-name-README.md (or original extension)
            const zipFilename = `${repo}-${filename}`;
            // Explicitly specify UTF-8 encoding for text files
            zip.file(zipFilename, content, { binary: false });
        });

        // Generate timestamp: YYYY-MM-DD_HH-MM-SS
        const now = new Date();
        const timestamp = now.toISOString()
            .replace(/T/, '_')
            .replace(/:/g, '-')
            .replace(/\..+/, '');

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${owner}-readmes-${timestamp}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
