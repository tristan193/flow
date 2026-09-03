import { permanentRedirect } from "next/navigation";

/** Classic Review used to live here. `/` now lands on the Next loop. */
export default function RootPage() {
  permanentRedirect("/next");
}
