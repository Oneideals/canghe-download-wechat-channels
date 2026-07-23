import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MARKER = "download-wechat-channels-v2";
const SHARE_RE = /^https:\/\/weixin\.qq\.com\/sph\/[A-Za-z0-9_-]+(?:\?[^\s<>"']*)?$/;
const AGENT_ID = "naQivTmsDa/cf4d0079-ed1b-4c55-a3f3-2ca1379727d1";

function assertShareUrl(shareUrl) {
  if (typeof shareUrl !== "string" || !SHARE_RE.test(shareUrl)) {
    throw new Error("INVALID_SHARE_LINK");
  }
}

export function buildLoginCheckExpression() {
  return `
    (async () => {
      const webApi = window.$webApi;
      if (!webApi?.getYbCommonHeaders || !webApi?.setContextualRequestHeaders) {
        return { ready: false, loggedIn: false };
      }
      const request = {
        url: "/api/getuserinfo",
        headers: {
          ...webApi.getYbCommonHeaders(),
          "Accept": "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest"
        }
      };
      await webApi.setContextualRequestHeaders(request);
      const response = await fetch(request.url, {
        method: "GET",
        credentials: "include",
        headers: request.headers
      });
      return { ready: true, loggedIn: response.ok };
    })()
  `;
}

export async function checkYuanbaoLogin(cdp) {
  const evaluated = await cdp.send("Runtime.evaluate", {
    expression: buildLoginCheckExpression(),
    awaitPromise: true,
    returnByValue: true
  });
  const state = evaluated?.result?.value;
  return {
    ready: state?.ready === true,
    loggedIn: state?.loggedIn === true
  };
}

export async function waitForYuanbaoLogin(
  cdp,
  { attempts = 15, intervalMs = 3000 } = {}
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await checkYuanbaoLogin(cdp);
    if (state.loggedIn) return true;
    if (attempt + 1 < attempts && intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

export function buildYuanbaoExpression(shareUrl) {
  assertShareUrl(shareUrl);
  return `
    (async (shareUrl, agentId) => {
      const webApi = window.$webApi;
      if (!webApi?.getYbCommonHeaders || !webApi?.setContextualRequestHeaders) {
        return { status: 0, code: "YUANBAO_PAGE_NOT_READY", body: "" };
      }

      const baseHeaders = {
        ...webApi.getYbCommonHeaders(),
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      };

      const userRequest = { url: "/api/getuserinfo", headers: { ...baseHeaders } };
      await webApi.setContextualRequestHeaders(userRequest);
      const userResponse = await fetch(userRequest.url, {
        method: "GET",
        credentials: "include",
        headers: userRequest.headers
      });
      const userText = await userResponse.text();
      if (!userResponse.ok) {
        return { status: userResponse.status, code: "YUANBAO_LOGIN_REQUIRED", body: userText };
      }

      let userInfo = {};
      try { userInfo = JSON.parse(userText); } catch (_) {}
      const userData = userInfo?.data && typeof userInfo.data === "object" ? userInfo.data : userInfo;
      const userId = userData?.userId || userData?.userid || userData?.user_id || userData?.id || "";

      const parseRequest = {
        url: "/api/weixin/get_parse_result",
        headers: { ...baseHeaders, "X-AgentID": agentId }
      };
      await webApi.setContextualRequestHeaders(parseRequest);
      if (userId) {
        parseRequest.headers["T-UserID"] = String(userId);
        parseRequest.headers["X-ID"] = String(userId);
      }
      const response = await fetch(parseRequest.url, {
        method: "POST",
        credentials: "include",
        headers: parseRequest.headers,
        body: JSON.stringify({ type: "video_channel_url", url: shareUrl, scene: 1 })
      });
      return {
        status: response.status,
        code: response.status === 401 ? "YUANBAO_LOGIN_REQUIRED" : "",
        body: await response.text()
      };
    })(${JSON.stringify(shareUrl)}, ${JSON.stringify(AGENT_ID)})
  `;
}

export function extractYuanbaoResponse(cdpResult) {
  const value = cdpResult?.result?.value;
  if (!value || typeof value !== "object") {
    throw new Error("YUANBAO_CDP_INVALID");
  }
  if (value.status === 401 || value.code === "YUANBAO_LOGIN_REQUIRED") {
    throw new Error("YUANBAO_LOGIN_REQUIRED");
  }
  if (value.status !== 200) {
    throw new Error(`YUANBAO_HTTP_${value.status || "UNKNOWN"}`);
  }
  let response;
  try {
    response = JSON.parse(value.body);
  } catch (_) {
    throw new Error("YUANBAO_RESPONSE_INVALID");
  }
  if (!response || typeof response !== "object" || !response.data?.playable_url) {
    throw new Error("YUANBAO_PROFILE_INVALID");
  }
  return {
    data: {
      playable_url: String(response.data.playable_url),
      wx_export_id: String(response.data.wx_export_id || "")
    }
  };
}

export async function writeOfficialProfile(profileFile, shareUrl, yuanbaoResponse) {
  assertShareUrl(shareUrl);
  const resolved = path.resolve(profileFile);
  const expectedParent = await fs.realpath(os.tmpdir());
  const actualParent = await fs.realpath(path.dirname(resolved));
  if (
    actualParent !== expectedParent ||
    !path.basename(resolved).startsWith("download-wechat-channels-") ||
    path.extname(resolved) !== ".json"
  ) {
    throw new Error("UNSAFE_PROFILE_PATH");
  }
  const before = await fs.lstat(resolved);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error("UNSAFE_PROFILE_PATH");
  }
  const handle = await fs.open(resolved, "r+");
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error("PROFILE_FILE_CHANGED");
    }
    const current = JSON.parse(await handle.readFile("utf8"));
    if (current.created_by !== MARKER || current.share_url !== shareUrl) {
      throw new Error("PROFILE_LINK_MISMATCH");
    }
    current.yuanbao_response = yuanbaoResponse;
    const serialized = `${JSON.stringify(current, null, 2)}\n`;
    await handle.truncate(0);
    await handle.write(serialized, 0, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return resolved;
}

export async function resolveYuanbaoToProfile(cdp, shareUrl, profileFile) {
  const evaluated = await cdp.send("Runtime.evaluate", {
    expression: buildYuanbaoExpression(shareUrl),
    awaitPromise: true,
    returnByValue: true
  });
  const sanitized = extractYuanbaoResponse(evaluated);
  return writeOfficialProfile(profileFile, shareUrl, sanitized);
}
