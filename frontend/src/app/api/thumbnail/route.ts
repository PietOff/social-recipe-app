import { NextResponse } from 'next/server';
import { resolveTikTokCover, TIKTOK_ID_RE, YOUTUBE_ID_RE } from '../../../lib/tiktokCover';

// Takes precedence over the /api/* rewrite to the backend: TikTok refuses
// Render's addresses, and answering here also spares a sleeping backend.

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'https://social-recipe-appsocial-recipe-backend.onrender.com'
).trim();

function redirect(url: string, maxAge: number) {
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: url,
      // The CDN keeps the answer, so a cookbook full of covers does not hit
      // TikTok on every view. Cover URLs stay valid for about a day.
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  });
}

export async function GET(request: Request) {
  const videoId = new URL(request.url).searchParams.get('video_id') || '';
  if (TIKTOK_ID_RE.test(videoId)) {
    const cover = await resolveTikTokCover(videoId);
    if (cover) return redirect(cover, 3600);
    // Last resort: the backend's own resolver.
    return redirect(`${BACKEND_URL}/thumbnail?video_id=${videoId}`, 300);
  }
  if (YOUTUBE_ID_RE.test(videoId)) {
    return redirect(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, 86400);
  }
  return NextResponse.json({ detail: 'Invalid video id.' }, { status: 400 });
}
