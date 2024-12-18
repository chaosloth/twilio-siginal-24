let testingMode: boolean = true;

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
import QRCode from "qrcode";
import sgMail from "@sendgrid/mail";

// If you want to use environment variables, you will need to type them like
// this and add them to the Context in the function signature as
// Context<MyContext> as you see below.
type MyContext = {
  SEGMENT_API_ACCESS_TOKEN: string;
  SEGMENT_PROFILES_API_BASE_URL: string;
  SEGMENT_SPACE_ID: string;
  SENDGRID_API_KEY: string;
  SENDGRID_TEMPLATE_ID: string;
  DEMO_AI_PHONE_NUMBER_URI: string;
  DEMO_EMAIL_FROM_ADDRESS: string;
  DEMO_EMAIL_FALLBACK_MESSAGE: string;
  VENDOR_1_NAME: string;
  VENDOR_1_URL: string;
  VENDOR_2_NAME: string;
  VENDOR_2_URL: string;
  VENDOR_3_NAME: string;
  VENDOR_3_URL: string;
  DEMO_TESTING_MODE: string;
};

export interface SegmentEvent {
  sentAt: Date;
  traits: Traits;
  userId: string;
  messageId: string;
  receivedAt: Date;
  originalTimestamp: Date;
  anonymousId: string;
  context: Context;
  projectId: string;
  timestamp: Date;
  type: string;
  channel: string;
  version: number;
}

export interface Traits {
  demo: string;
  name: string;
  company: string;
  phone: string;
  email: string;
}

export const handler: ServerlessFunctionSignature<MyContext, SegmentEvent> =
  async function (
    context: Context<MyContext>,
    event: SegmentEvent,
    callback: ServerlessCallback
  ) {
    console.log(`Incoming Segment Event >> `, event);
    const response = new Twilio.Response();
    try {
      if (!event.traits.phone) {
        response.setStatusCode(404);
        response.setBody({ status: "Missing phone parameter" });
        return callback(null, response);
      }

      let token = Buffer.from(
        `${context.SEGMENT_API_ACCESS_TOKEN}:`,
        "utf8"
      ).toString("base64");

      const anonymousId = encodeURIComponent(event.anonymousId);
      const url = `${context.SEGMENT_PROFILES_API_BASE_URL}/spaces/${context.SEGMENT_SPACE_ID}/collections/users/profiles/anonymous_id:${anonymousId}/traits?limit=200`;
      console.log(`Fetching segment traits from: ${url}`);

      var options = {
        method: "GET",
        headers: {
          Authorization: `Basic ${token}`,
        },
      };

      const result = await fetch(url, options);
      console.log(`Have fetch result`);
      let profile = await result.json();
      console.log(`Profile`, JSON.stringify(profile, null, 2));

      // Guard clause
      if (!profile || !profile.hasOwnProperty("traits")) {
        response.setBody({ status: "Profile not found" });
        response.setStatusCode(404);
        return callback(null, response);
      }

      // Merge this event and profile
      profile.traits = {
        ...event.traits,
        ...profile.traits,
      };

      console.log(`Setting body`);
      response.appendHeader("Content-Type", "application/json");
      response.setBody(profile.traits);

      let contentToEncode = `tel:${profile.traits.phone}`;
      const qrcodeData = await QRCode.toDataURL(contentToEncode, {
        type: "image/png",
        color: {
          dark: "#121C2D",
        },
      });

      const frequencies = new Array(
        "all day",
        "a couple of times a week",
        "occasionally"
      );
      const temperatures = new Array(
        "warm it is in Singapore",
        "freezing cold conference rooms can be"
      );

      let snackFreq: string;
      let snackTemp: string;
      let snackType: string = profile.traits.sweet_or_healthy || "Sweet"; //set direct since value is direct

      switch (profile.traits.snack_frequency) {
        case "Daily":
          snackFreq = frequencies[0];
          break;

        case "Weekly":
          snackFreq = frequencies[1];
          break;

        case "Occasionally":
          snackFreq = frequencies[2];
          break;

        default:
          snackFreq = frequencies[0];
          break;
      }

      switch (profile.traits.snack_temperature) {
        case "Cold":
          snackTemp = temperatures[0];
          break;
        case "Warm":
          snackTemp = temperatures[1];
          break;
        default:
          snackTemp = temperatures[0];
          break;
      }

      console.log("Snack temp:" + snackTemp);
      console.log("Snack type:" + snackType);
      console.log("Snack freq:" + snackFreq);

      const vendors = [
        { name: context.VENDOR_1_NAME, url: context.VENDOR_1_URL },
        { name: context.VENDOR_2_NAME, url: context.VENDOR_2_URL },
        { name: context.VENDOR_3_NAME, url: context.VENDOR_3_URL },
      ];
      let choice: number;

      if (snackType == "Healthy") {
        choice = 2; // Salad Stop
      } else if (
        snackType == "Sweet" &&
        profile.traits.snack_temperature == "Warm"
      ) {
        choice = 0; // Dunkin Donuts
      } else {
        choice = 1; // Udders Ice Cream
      }

      console.log("Recommended Vendor:", vendors[choice]);

      const message: sgMail.MailDataRequired | any = {
        from: context.DEMO_EMAIL_FROM_ADDRESS,
        templateId: context.SENDGRID_TEMPLATE_ID, // SendGrid Template ID
        personalizations: [
          // Personalization strings
          {
            to: [
              {
                email: profile.traits.email,
              },
            ],
            dynamicTemplateData: {
              url: vendors[choice].url,
              tel: context.DEMO_AI_PHONE_NUMBER_URI,
              snackVendor: vendors[choice].name,
              firstName: profile.traits.name,
              snackTemp: snackTemp,
              snackFreq: snackFreq,
              snackType: snackType.toLowerCase(),
              snackTypeHeader: snackType,
            },
          },
        ],
        attachments: [
          {
            content: qrcodeData.split(",")[1],
            content_id: "qrcode",
            filename: "qrcode.png",
            type: "image/png",
            disposition: "inline",
          },
        ],
      };

      // Only set testing mode to false if environment variable is false
      testingMode = context.DEMO_TESTING_MODE === "true" ? true : false;

      if (testingMode) {
        console.log(`Sending data to SendGrid`, message);
        response.setBody({
          debug_sendgrid: message,
          debug_profile_traits: profile.traits,
        });
        return callback(null, response);
      }

      console.log(`Sending email to: ${profile.traits.email}`);
      sgMail.setApiKey(context.SENDGRID_API_KEY);
      const sgResponse = await sgMail.send(message);
      console.log(`Message sent`, sgResponse);
      response.setBody({ status: "Sent" });
      return callback(null, response);
    } catch (err: any) {
      console.log(`Error sending personalised email`, err);
      return callback(err);
    }
  };
