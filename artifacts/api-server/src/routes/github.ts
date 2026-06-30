import { Router, type IRouter } from "express";
import { Octokit } from "octokit";
import {
  ConfigureGithubBody,
  ListGithubFilesQueryParams,
  ReadGithubFileQueryParams,
  WriteGithubFileBody,
  DeleteGithubFileBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

let octokit: Octokit | null = null;
let currentOwner: string | null = null;
let currentRepo: string | null = null;

router.post("/github/configure", (req, res) => {
  const parsed = ConfigureGithubBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const { token, repo } = parsed.data;
  const parts = repo.split("/");
  if (parts.length !== 2) {
    res.status(400).json({ error: "repo must be in owner/name format" });
    return;
  }
  octokit = new Octokit({ auth: token });
  currentOwner = parts[0];
  currentRepo = parts[1];
  res.json({ success: true });
});

router.get("/github/files", async (req, res) => {
  if (!octokit || !currentOwner || !currentRepo) {
    res.status(400).json({ error: "Not configured. Call /api/github/configure first." });
    return;
  }

  const parsed = ListGithubFilesQueryParams.safeParse(req.query);
  const path = parsed.success && parsed.data.path ? parsed.data.path : "";

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: currentOwner,
      repo: currentRepo,
      path,
    });

    if (Array.isArray(data)) {
      const entries = data.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: "size" in item ? item.size : null,
      }));
      res.json(entries);
    } else {
      res.json([{
        name: (data as { name: string }).name,
        path: (data as { path: string }).path,
        type: (data as { type: string }).type,
        size: null,
      }]);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    req.log.error({ err: e }, "GitHub list files error");
    res.status(500).json({ error: msg });
  }
});

router.get("/github/read", async (req, res) => {
  if (!octokit || !currentOwner || !currentRepo) {
    res.status(400).json({ error: "Not configured. Call /api/github/configure first." });
    return;
  }

  const parsed = ReadGithubFileQueryParams.safeParse(req.query);
  if (!parsed.success || !parsed.data.path) {
    res.status(400).json({ error: "path is required" });
    return;
  }

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: currentOwner,
      repo: currentRepo,
      path: parsed.data.path,
    });

    if (Array.isArray(data)) {
      res.json({ type: "directory", content: null, sha: null });
      return;
    }

    const file = data as { type: string; content?: string; sha: string; encoding?: string };
    if (file.type !== "file") {
      res.json({ type: file.type, content: null, sha: null });
      return;
    }

    const content = file.content
      ? Buffer.from(file.content, "base64").toString("utf8")
      : "";

    res.json({ type: "file", content, sha: file.sha });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    req.log.error({ err: e }, "GitHub read file error");
    res.status(500).json({ error: msg });
  }
});

router.post("/github/write", async (req, res) => {
  if (!octokit || !currentOwner || !currentRepo) {
    res.status(400).json({ error: "Not configured. Call /api/github/configure first." });
    return;
  }

  const parsed = WriteGithubFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const { path, content, sha, message } = parsed.data;

  try {
    const params: Parameters<typeof octokit.rest.repos.createOrUpdateFileContents>[0] = {
      owner: currentOwner,
      repo: currentRepo,
      path,
      message: message ?? (sha ? `Update ${path} via Agent IDE` : `Create ${path} via Agent IDE`),
      content: Buffer.from(content).toString("base64"),
    };

    // Only include sha if provided (sha is absent for new file creation)
    if (sha) {
      params.sha = sha;
    }

    await octokit.rest.repos.createOrUpdateFileContents(params);
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    req.log.error({ err: e }, "GitHub write file error");
    res.status(500).json({ error: msg });
  }
});

router.post("/github/delete", async (req, res) => {
  if (!octokit || !currentOwner || !currentRepo) {
    res.status(400).json({ error: "Not configured. Call /api/github/configure first." });
    return;
  }

  const parsed = DeleteGithubFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const { path, sha, message } = parsed.data;

  try {
    await octokit.rest.repos.deleteFile({
      owner: currentOwner,
      repo: currentRepo,
      path,
      message: message ?? `Delete ${path} via Agent IDE`,
      sha,
    });
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    req.log.error({ err: e }, "GitHub delete file error");
    res.status(500).json({ error: msg });
  }
});

export default router;
