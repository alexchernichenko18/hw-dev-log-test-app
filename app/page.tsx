import { Suspense } from "react";
import { TaskBoard } from "@/components/task-board";

export default function Home() {
  return (
    // TaskBoard reads the URL search params, so it renders on the client inside a Suspense boundary.
    <Suspense>
      <TaskBoard />
    </Suspense>
  );
}
