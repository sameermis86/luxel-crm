import { redirect } from "next/navigation";

/** Old address of the Reminders page (texts and emails). */
export default function TextsPage() {
  redirect("/reminders");
}
