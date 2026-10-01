"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export function SessionApiReference() {
  return (
    <SwaggerUI
      url="/api/openapi"
      plugins={[{ components: { onlineValidatorBadge: () => null } }]}
      persistAuthorization={false}
      supportedSubmitMethods={["post"]}
      docExpansion="list"
    />
  );
}
