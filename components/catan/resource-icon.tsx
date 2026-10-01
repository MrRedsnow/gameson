import type { SVGProps } from "react";
import type { Resource } from "@/lib/catan";

type ResourceIconProps = SVGProps<SVGSVGElement> & { resource: Resource };

/** Material colors and broad silhouettes keep the resources readable at inventory size. */
export function ResourceIcon({ resource, className, ...props }: ResourceIconProps) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" data-resource={resource} className={`catan-resource-icon${resource === "wood" ? " catan-wood-icon" : ""}${className ? ` ${className}` : ""}`} {...props}>
    {resource === "wood" && <>
      <path d="m11 3 15 2c5 1 5 7 1 8l-16-1Z" fill="#805638" stroke="#513a29" strokeWidth=".8" />
      <path d="m14 5 12 2m-11 3 12 1" stroke="#b98a55" strokeWidth="1" />
      <ellipse cx="11" cy="7.5" rx="4.5" ry="4.5" fill="#e5bf80" stroke="#6e4a2e" strokeWidth="1" />
      <path d="M9 5c4-1 5 5 1 5M11 7l1 1" stroke="#a57643" strokeWidth=".9" />
      <path d="m18 17 10-2c5 1 5 7 1 9l-11 3Z" fill="#73503a" stroke="#513a29" strokeWidth=".8" />
      <path d="m20 19 9-2m-8 6 7-2" stroke="#ad7b4b" strokeWidth="1" />
      <ellipse cx="18" cy="22" rx="4.5" ry="5" fill="#d7ad70" stroke="#6e4a2e" strokeWidth="1" />
      <path d="m7 16 14-3c5 0 7 7 3 10L7 27Z" fill="#966540" stroke="#513a29" strokeWidth=".8" />
      <path d="m10 18 12-3m-10 8 11-3" stroke="#c39965" strokeWidth="1" />
      <ellipse cx="7" cy="21.5" rx="5" ry="5.5" fill="#efd19a" stroke="#6e4a2e" strokeWidth="1" />
      <path d="M6 18c4-1 5 6 1 7-3 0-4-4-1-5l2 1" stroke="#ad804c" strokeWidth="1" />
    </>}
    {resource === "brick" && <g stroke="#713e2a" strokeWidth=".65">
      <path d="m2 19 10-4 10 4-10 5Z" fill="#da9469" /><path d="m2 19 10 5v6L2 25Z" fill="#b76442" /><path d="m12 24 10-5v6l-10 5Z" fill="#8f4935" />
      <path d="m14 16 9-4 8 4-9 5Z" fill="#dda177" /><path d="m14 16 8 5v7l-8-5Z" fill="#b56a48" /><path d="m22 21 9-5v7l-9 5Z" fill="#8e4c36" />
      <path d="m6 9 10-5 11 5-11 5Z" fill="#ebb28a" /><path d="m6 9 10 5v7L6 16Z" fill="#c77851" /><path d="m16 14 11-5v7l-11 5Z" fill="#a5583c" />
      <path d="m9 10 7 3m3 2 5-3M5 22l4 2" stroke="#f0b98e" />
    </g>}
    {resource === "wool" && <>
      <path d="m9 21-1 7h4l1-7m8-1 1 8h4l-2-9" fill="#514d44" />
      <path d="M4 13c-3-3-4 2-1 4" stroke="#e1d9bd" strokeWidth="2.2" />
      <path d="M4 15c-1-4 2-8 5-7 1-4 6-5 8-2 4-2 8 1 8 5 4 2 4 7 1 9-1 4-5 5-8 3-4 2-8 1-9-1-4 0-6-4-5-7Z" fill="#e9e3cf" />
      <path d="M5 17c1 5 7 5 10 3 3 2 8 1 10-2l-1 5-6 1-7-1-6-3Z" fill="#c4bba1" />
      <path d="M9 11c1-2 4-2 5-1m1 6c2 1 4 0 5-2" stroke="#fff9e8" strokeWidth="1.7" />
      <path d="m24 10 5-2 2 3-5 2m-3-2-3-3-2 2 4 4" fill="#686457" />
      <path d="M23 10c5-2 7 1 6 5l-1 5c-1 3-5 2-6-1l-1-5Z" fill="#494b43" />
      <path d="m26 12 1 4" stroke="#777769" strokeWidth="1.5" /><circle cx="25.5" cy="13" r=".7" fill="#f8edcc" />
    </>}
    {resource === "grain" && <>
      <path d="M10 29 7 9m8 20 1-25m4 25 6-20" stroke="#bc9448" strokeWidth="1.5" />
      <g fill="#e7bb5c" stroke="#a77c36" strokeWidth=".45">
        <path d="M7 20C1 20 1 15 2 14c4 0 6 3 5 6Zm0-5C2 14 2 10 3 9c4 1 5 4 4 6Zm0-5C4 7 5 4 6 3c3 2 4 5 1 7Zm1 12c-1-5 2-7 5-7 1 4-1 7-5 7Zm-1-7c0-4 3-6 5-6 1 4-1 6-5 6Z" />
        <path d="M16 22c-6-1-7-5-6-7 4 0 7 3 6 7Zm0-6c-5-1-6-5-5-7 4 0 6 3 5 7Zm0-6c-4-2-3-6 0-9 3 3 4 7 0 9Zm0 12c0-5 3-7 6-7 1 4-1 7-6 7Zm0-6c0-4 3-7 5-7 2 4-1 6-5 7Z" />
        <path d="M22 24c-4-2-5-5-3-7 3 1 5 3 3 7Zm2-6c-4-2-4-5-2-7 3 1 4 4 2 7Zm2-6c-2-3-1-6 2-8 2 3 2 6-2 8Zm-4 12c1-4 4-6 7-5 0 4-3 6-7 5Zm2-6c1-4 4-6 7-5 0 4-3 6-7 5Z" />
      </g>
      <path d="m10 26 10 1" stroke="#dfc18b" strokeWidth="2" />
    </>}
    {resource === "ore" && <g stroke="#444f58" strokeWidth=".7">
      <path d="m3 17 5-7 8 2 3 11-10 5-7-4Z" fill="#7f9098" /><path d="m3 17 8 2 5-7-8-2Z" fill="#b7c4c6" /><path d="m11 19 8 4-10 5Z" fill="#576b76" />
      <path d="m13 7 6-5 8 3 2 10-7 7-10-5Z" fill="#8b9ca5" /><path d="m13 7 9 2 5-4-8-3Z" fill="#d0d8d6" /><path d="m22 9 7 6-7 7Z" fill="#596d7c" />
      <path d="m16 24 4-7 8 1 3 8-7 4-8-2Z" fill="#a1b0b4" /><path d="m16 24 9-1 3-5-8-1Z" fill="#d4dcd8" /><path d="m25 23 6 3-7 4Z" fill="#687b86" />
      <path d="m17 10 2 4m-9 8-3 1m16 3 2 1" stroke="#e0e6dd" strokeWidth="1" />
    </g>}
  </svg>;
}

export function WoodIcon(props: SVGProps<SVGSVGElement>) {
  return <ResourceIcon resource="wood" {...props} />;
}
