import { config } from "@/lib/config";

type SlackOAuthResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  authed_user?: {
    id: string;
    access_token?: string;
  };
  team?: {
    id: string;
    name: string;
  };
};

type SlackUserInfoResponse = {
  ok: boolean;
  error?: string;
  user?: {
    id: string;
    team_id?: string;
    name?: string;
    real_name?: string;
    profile?: {
      display_name?: string;
      real_name?: string;
      image_72?: string;
    };
  };
};

type SlackPostMessageResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
};

type SlackOpenConversationResponse = {
  ok: boolean;
  error?: string;
  channel?: {
    id?: string;
  };
};

type SlackGetUploadUrlExternalResponse = {
  ok: boolean;
  error?: string;
  upload_url?: string;
  file_id?: string;
};

type SlackCompleteUploadExternalResponse = {
  ok: boolean;
  error?: string;
};

export function buildSlackAuthorizeUrl(state: string): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", config.slackClientId);
  url.searchParams.set("user_scope", "identity.basic,identity.avatar");
  url.searchParams.set("redirect_uri", config.slackRedirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeSlackCode(code: string): Promise<SlackOAuthResponse> {
  const body = new URLSearchParams({
    client_id: config.slackClientId,
    client_secret: config.slackClientSecret,
    code,
    redirect_uri: config.slackRedirectUri
  });

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  return response.json() as Promise<SlackOAuthResponse>;
}

export async function fetchSlackUserInfo(userAccessToken: string): Promise<SlackUserInfoResponse> {
  const response = await fetch("https://slack.com/api/users.identity", {
    headers: { Authorization: `Bearer ${userAccessToken}` }
  });

  return response.json() as Promise<SlackUserInfoResponse>;
}

export async function postSlackMessage({
  botToken,
  channel,
  text
}: {
  botToken: string;
  channel: string;
  text: string;
}): Promise<SlackPostMessageResponse> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ channel, text, mrkdwn: true })
  });

  return response.json() as Promise<SlackPostMessageResponse>;
}

export async function openSlackConversation({
  botToken,
  userId
}: {
  botToken: string;
  userId: string;
}): Promise<SlackOpenConversationResponse> {
  const response = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ users: userId })
  });

  return response.json() as Promise<SlackOpenConversationResponse>;
}

export async function uploadSlackFile({
  botToken,
  channel,
  filename,
  title,
  initialComment,
  fileBuffer,
  mimeType
}: {
  botToken: string;
  channel: string;
  filename: string;
  title: string;
  initialComment: string;
  fileBuffer: Buffer;
  mimeType: string;
}): Promise<SlackCompleteUploadExternalResponse> {
  const uploadUrlBody = new URLSearchParams({
    filename,
    length: fileBuffer.byteLength.toString()
  });

  const uploadUrlResponse = await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: uploadUrlBody
  });
  const uploadUrlPayload = (await uploadUrlResponse.json()) as SlackGetUploadUrlExternalResponse;

  if (!uploadUrlPayload.ok || !uploadUrlPayload.upload_url || !uploadUrlPayload.file_id) {
    return { ok: false, error: uploadUrlPayload.error ?? "upload_url_failed" };
  }

  const uploadResponse = await fetch(uploadUrlPayload.upload_url, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": fileBuffer.byteLength.toString()
    },
    body: new Uint8Array(fileBuffer)
  });

  if (!uploadResponse.ok) {
    return { ok: false, error: `file_upload_failed_${uploadResponse.status}` };
  }

  const completeResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      channel_id: channel,
      initial_comment: initialComment,
      files: [{ id: uploadUrlPayload.file_id, title }]
    })
  });

  return completeResponse.json() as Promise<SlackCompleteUploadExternalResponse>;
}
