import type { ReactNode } from "react";
import { ago, compactCount } from "@/lib/chimi/format";
import { xPieces, type XMedia, type XPost } from "@/lib/chimi/x-rules";
import { IconComment, IconExternal, IconEye, IconHeart, IconPlay, IconRepost, IconX } from "@/components/chimi/icons";

/*
 * A post on X about a coin, drawn the way the feed draws a comment: who posted it, what they said, their pictures,
 * and (in the feed) the coin as a card under it. Everything on it opens the post, or the account, on X. Pictures come
 * straight from X's image host.
 */

const out = { target: "_blank", rel: "noopener noreferrer" } as const;

/** X's blue check. */
function Verified() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" aria-label="Verified on X" role="img" className="shrink-0 text-[#1d9bf0]">
      <path
        fill="currentColor"
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.2 3.34c-.46 1.39-.2 2.9.8 3.91 1.01 1.01 2.52 1.27 3.92.81.66 1.31 1.9 2.19 3.33 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"
      />
      <path fill="#fff" d="m10.75 15.6-3.4-3.4 1.4-1.4 2 2 4.5-4.6 1.4 1.4z" />
    </svg>
  );
}

/** X serves its pictures in a few sizes; a grid cell needs the small one. */
const sized = (url: string, name: "small" | "medium") => (url.includes("?") ? url : `${url}?name=${name}`);

function Media({ post }: { post: XPost }) {
  const n = post.media.length;
  const one: XMedia | undefined = n === 1 ? post.media[0] : undefined;
  // One picture keeps roughly its shape; a very tall or very wide one is cropped, as X crops it.
  const ratio = one?.width && one.height ? Math.min(Math.max(one.width / one.height, 0.8), 2) : 16 / 9;
  return (
    <a href={post.url} {...out} className={`x-media x-media-${n}`} style={one ? { aspectRatio: String(ratio) } : undefined} aria-label="Open the post on X">
      {post.media.map((m, i) => (
        <span key={`${m.url}:${i}`} className="x-media-cell">
          <img src={sized(m.url, one ? "medium" : "small")} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          {m.kind === "video" ? (
            <span className="x-play">
              <IconPlay size={18} />
            </span>
          ) : m.kind === "gif" ? (
            <span className="x-play">GIF</span>
          ) : null}
        </span>
      ))}
    </a>
  );
}

function Words({ post }: { post: XPost }) {
  return (
    <>
      {xPieces(post.text, post.links).map((piece, i) =>
        piece.href ? (
          <a key={i} href={piece.href} {...out} className="text-gold hover:underline">
            {piece.text}
          </a>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  );
}

function Count({ href, label, icon, n }: { href: string; label: string; icon: ReactNode; n: number }) {
  return (
    <a href={href} {...out} className="comment-act" aria-label={`${n} ${label} on X`}>
      {icon}
      {n > 0 ? <span className="num">{compactCount(n)}</span> : null}
    </a>
  );
}

/**
 * One post. `now` is unix seconds; `symbol` names the coin when the post is from its own account; `children` go
 * under the words and pictures (the feed puts the coin's card there).
 */
export function XPostCard({ post, now, symbol, fresh, children }: { post: XPost; now: number; symbol?: string; fresh?: boolean; children?: ReactNode }) {
  const profile = `https://x.com/${post.handle}`;
  return (
    <li className={`feed-item post ${fresh ? "feed-item-new" : ""}`}>
      <span className="post-lead">
        <a href={profile} {...out} aria-label={`${post.name} on X`} className="x-avatar">
          {post.avatar ? <img src={post.avatar} alt="" width={38} height={38} loading="lazy" referrerPolicy="no-referrer" /> : <span>{post.name.slice(0, 1).toUpperCase()}</span>}
        </a>
      </span>
      <div className="min-w-0 flex-1">
        <p className="post-head">
          <span className="inline-flex min-w-0 items-center gap-1">
            <a href={profile} {...out} className="truncate font-semibold text-fg hover:text-gold">
              {post.name}
            </a>
            {post.verified ? <Verified /> : null}
          </span>
          <a href={profile} {...out} className="min-w-0 truncate text-faint hover:text-muted">
            @{post.handle}
          </a>
          {post.via === "account" && symbol ? <span className="tag tag-gold">{symbol}’s account</span> : null}
          <a href={post.url} {...out} className="num shrink-0 text-faint hover:text-muted">
            · {ago(Math.max(0, now - post.time))}
          </a>
          <a href={post.url} {...out} className="x-mark" aria-label="Open the post on X" title="Open the post on X">
            <IconX size={14} />
          </a>
        </p>
        {post.text ? (
          <p className="post-text">
            <Words post={post} />
          </p>
        ) : null}
        {post.media.length > 0 ? <Media post={post} /> : null}
        {children}
        <div className="post-acts x-acts">
          <Count href={post.url} label="replies" icon={<IconComment size={15} />} n={post.replies} />
          <Count href={post.url} label="reposts" icon={<IconRepost size={15} />} n={post.reposts} />
          <Count href={post.url} label="likes" icon={<IconHeart size={15} />} n={post.likes} />
          {post.views > 0 ? (
            <span className="x-views" aria-label={`${post.views} views on X`}>
              <IconEye size={15} />
              <span className="num">{compactCount(post.views)}</span>
            </span>
          ) : null}
          <a href={post.url} {...out} className="comment-act x-open">
            <span>Open on X</span>
            <IconExternal size={12} />
          </a>
        </div>
      </div>
    </li>
  );
}
