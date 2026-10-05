import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // 画面とサーバーが同じビルドかを見分けるためのバージョン（デプロイ後の古いタブからの全体保存を止める）
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "local"
  }
};

export default nextConfig;
