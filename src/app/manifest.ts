import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name, short_name: brand.name, description: brand.description, lang: "tr",
    start_url: "/", display: "standalone", background_color: "#f7f8f5", theme_color: brand.themeColor,
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }, { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
