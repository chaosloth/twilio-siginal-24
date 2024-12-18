// Imports global types
import "@twilio-labs/serverless-runtime-types";
// Fetches specific types
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from "@twilio-labs/serverless-runtime-types/types";

// Use Node Fetch
const fetch = require("node-fetch");

type MyEvent = {
  phone: string;
};

// If you want to use environment variables, you will need to type them like
// this and add them to the Context in the function signature as
// Context<MyContext> as you see below.
type MyContext = {
  SEGMENT_API_ACCESS_TOKEN: string;
  SEGMENT_PROFILES_API_BASE_URL: string;
  SEGMENT_SPACE_ID: string;
};

export const handler: ServerlessFunctionSignature<MyContext, MyEvent> =
  async function (
    context: Context<MyContext>,
    event: MyEvent,
    callback: ServerlessCallback
  ) {
    console.log(`Incoming Segment Lookup Request >> `, event);
    const response = new Twilio.Response();
    try {
      if (!event.phone) {
        response.setStatusCode(404);
        response.setBody({ status: "Missing phone parameter" });
        return callback(null, response);
      }

      let token = Buffer.from(
        `${context.SEGMENT_API_ACCESS_TOKEN}:`,
        "utf8"
      ).toString("base64");

      const userId = encodeURIComponent(event.phone);

      const startsWithClient = /^client:/i.test(event.phone);
      const lookup_type = startsWithClient ? "client_id" : "phone";

      const url = `${context.SEGMENT_PROFILES_API_BASE_URL}/spaces/${context.SEGMENT_SPACE_ID}/collections/users/profiles/${lookup_type}:${userId}/traits?limit=200`;
      console.log(`Fetching segment traits from: ${url}`);

      var options = {
        method: "GET",
        headers: {
          Authorization: `Basic ${token}`,
        },
      };

      const result = await fetch(url, options);

      console.log(`Have fetch result`);
      const segmentPayload = await result.json();

      console.log(`Profile`, JSON.stringify(segmentPayload, null, 2));

      // Guard clause
      if (!segmentPayload || !segmentPayload.hasOwnProperty("traits")) {
        response.setBody({ status: "Profile not found" });
        response.setStatusCode(404);
        return callback(null, response);
      }

      console.log(`Setting body`);
      response.appendHeader("Content-Type", "application/json");
      response.setBody(segmentPayload.traits);

      return callback(null, response);
    } catch (err: any) {
      console.log(`Error fetching profile`, err);
      return callback(err);
    }
  };