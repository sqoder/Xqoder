export interface ParsedGitHubRepositoryUrl {
    owner: string;
    repo: string;
    normalizedUrl: string;
    slug: string;
}

const GITHUB_REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubRepositoryUrl(value: string): ParsedGitHubRepositoryUrl | undefined {
    try {
        const parsed = new URL(value.trim());
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== 'github.com' && hostname !== 'www.github.com') {
            return undefined;
        }

        const [ownerSegment, repoSegment] = parsed.pathname
            .split('/')
            .filter(Boolean)
            .slice(0, 2);
        const repo = repoSegment?.replace(/\.git$/i, '');
        if (!ownerSegment || !repo) {
            return undefined;
        }
        if (!GITHUB_REPO_SEGMENT.test(ownerSegment) || !GITHUB_REPO_SEGMENT.test(repo)) {
            return undefined;
        }

        const owner = ownerSegment.toLowerCase();
        const repoName = repo.toLowerCase();
        const slug = `${owner}/${repoName}`;
        return {
            owner,
            repo: repoName,
            normalizedUrl: `https://github.com/${owner}/${repoName}.git`,
            slug,
        };
    } catch {
        return undefined;
    }
}

export function isGitHubRepositoryUrl(value: string): boolean {
    return Boolean(parseGitHubRepositoryUrl(value));
}
