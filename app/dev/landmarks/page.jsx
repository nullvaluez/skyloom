import { notFound } from "next/navigation";
import LandmarkReview from "./review";
export default async function Page({ searchParams }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <LandmarkReview query={await searchParams} />;
}
