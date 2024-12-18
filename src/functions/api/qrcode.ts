// Imports global types
import "@twilio-labs/serverless-runtime-types";
// Fetches specific types
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from "@twilio-labs/serverless-runtime-types/types";

import QRCode from "qrcode";

type MyEvent = {
  data: string;
};

// If you want to use environment variables, you will need to type them like
// this and add them to the Context in the function signature as
// Context<MyContext> as you see below.
type MyContext = {};

export const handler: ServerlessFunctionSignature<MyContext, MyEvent> =
  async function (
    context: Context<MyContext>,
    event: MyEvent,
    callback: ServerlessCallback
  ) {
    console.log(`Incoming QR Code Generation Request >> `, event);
    const response = new Twilio.Response();
    response.appendHeader("Access-Control-Allow-Origin", "*");
    response.appendHeader(
      "Access-Control-Allow-Methods",
      "GET,PUT,POST,DELETE"
    );
    response.appendHeader(
      "Access-Control-Allow-Headers",
      "Authorization,Content-Type,Accept"
    );

    try {
      if (!event.data) {
        response.setStatusCode(404);
        response.setBody({ status: "Missing phone parameter" });
        return callback(null, response);
      }

      let contentToEncode = `${event.data}`;
      const code = await QRCode.toString(contentToEncode, {
        type: "svg",
        color: {
          dark: "#121C2D",
        },
      });

      response.setHeaders({ "Content-Type": "image/svg+xml" });
      response.setBody(code);
      return callback(null, response);
    } catch (err: any) {
      console.log(`Error fetching profile`, err);
      return callback(err);
    }
  };
