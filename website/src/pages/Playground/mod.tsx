import { Component } from "solid-js";

import MainCard from "./MainCard";

export default (() => {
  return (
    <div
      class={`
        flex justify-center flex-col items-center
      `}
    >
      <MainCard />
    </div>
  );
}) satisfies Component;