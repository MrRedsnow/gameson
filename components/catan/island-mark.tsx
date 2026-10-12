import { useId } from "react";

/** Small vector illustrations stay crisp at every screen size. */
export function IslandMark({ sunset = false }: { sunset?: boolean }) {
  const id = `island-mark-${useId().replace(/:/g, "")}`;
  return <svg className="catan-island-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <defs><linearGradient id={id} x1="18" y1="8" x2="43" y2="54" gradientUnits="userSpaceOnUse"><stop stopColor="#ffe8a1" /><stop offset="1" stopColor="#f0a34e" /></linearGradient></defs>
    {sunset ? <>
      <circle cx="32" cy="29" r="23" fill={`url(#${id})`} />
      <path d="M5 43c8-5 17 2 25-1s16-6 29-1l-5 11H10Z" fill="#245667" />
      <path d="m17 44 14-5 11 3-7 4H17Zm7 7 18-3 7 3-14 3H22Z" fill="#e6bd75" />
      <path d="M12 56h40M20 61h24" stroke="#408398" strokeWidth="3" strokeLinecap="round" />
    </> : <>
      <path d="M4 51c9-5 17-4 27-2 11-4 20-3 29 2-8 6-15 8-28 8S11 57 4 51Z" fill="#39859a" />
      <path d="M11 47c4-7 11-10 20-10 10 0 18 5 22 12H12Z" fill={`url(#${id})`} />
      <path d="M27 42c1-11 5-22 12-32l4 3c-6 10-9 19-10 30Z" fill="#bf874b" />
      <path d="m31 30 5 2m-2-9 5 2m-1-9 5 2" stroke="#ecc887" strokeWidth="1.5" />
      <path d="M40 13C30 1 20 5 19 13c7-3 14-1 21 0ZM40 13C29 8 18 14 17 23c7-5 15-7 23-10ZM40 13C40 1 49 0 55 9c-7-1-10 1-15 4ZM40 13c11-9 21-3 21 8-7-5-13-7-21-8ZM40 13c10 0 15 9 11 18-2-8-6-12-11-18Z" fill="#86ab46" />
      <circle cx="39" cy="15" r="3" fill="#956137" />
      <path d="M16 58h33M24 62h18" stroke="#245667" strokeWidth="2" strokeLinecap="round" />
    </>}
  </svg>;
}
