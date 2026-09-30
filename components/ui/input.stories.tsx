import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useId } from "react";
import { expect, userEvent } from "storybook/test";
import { Input } from "./input";
import { Label } from "./label";

/** The knobs for a complete text field: label, input, and either supporting text or an error. */
interface TextFieldArgs {
  readonly label: string;
  readonly placeholder: string;
  readonly type: "text" | "email" | "password";
  readonly size: "short" | "long";
  readonly enabled: boolean;
  readonly error: boolean;
  readonly supportingText: string;
  readonly errorText: string;
}

const SHORT_VALUE = "Marcus Lim";
const LONG_VALUE = "Weekend Tennis Crew at Bukit Timah Community Club, Saturdays 7am, all levels welcome";

/** Label + Input + supporting or error text, wired the way the app's forms do it (aria-invalid, aria-describedby). */
function TextField({ label, placeholder, type, size, enabled, error, supportingText, errorText }: TextFieldArgs) {
  // Unique per field, so several fields on one page (e.g. the Docs page) each point at their own label and message.
  const inputId = useId();
  const messageId = `${inputId}-message`;
  const message = error ? errorText : supportingText;

  return (
    <div className="max-w-sm space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        // Remount when the size knob changes so the example value updates.
        key={size}
        id={inputId}
        type={type}
        placeholder={placeholder}
        defaultValue={size === "long" ? LONG_VALUE : SHORT_VALUE}
        disabled={!enabled}
        aria-invalid={error}
        aria-describedby={message === "" ? undefined : messageId}
        className={error ? "border-destructive focus-visible:ring-destructive" : undefined}
      />
      {message !== "" && (
        <p id={messageId} className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message}
        </p>
      )}
    </div>
  );
}

const meta = {
  title: "Design system/Input (text field)",
  component: TextField,
  parameters: {
    docs: {
      description: {
        component:
          "`<Input>` is the shadcn/ui text input with a white (`bg-card`) background. Forms put it together with a " +
          "`<Label>` and a message line: supporting text normally, or a red error with `aria-invalid` and " +
          "`aria-describedby` so screen readers read the error with the field. Use the knobs to switch between " +
          "the states.",
      },
    },
  },
  argTypes: {
    label: { control: "text", description: "The field label." },
    placeholder: { control: "text", description: "Hint shown when empty." },
    type: { control: "inline-radio", options: ["text", "email", "password"], description: "HTML input type." },
    size: {
      control: "inline-radio",
      options: ["short", "long"],
      description: "Example value length, to check how long text is handled.",
    },
    enabled: { control: "boolean", description: "Off = disabled (greyed out, can't type)." },
    error: { control: "boolean", description: "Shows the error text in red and marks the input invalid." },
    supportingText: { control: "text", description: "Helper text under the field (hidden while there's an error)." },
    errorText: { control: "text", description: "Message shown when `error` is on." },
  },
  args: {
    label: "Name",
    placeholder: "Marcus Lim",
    type: "text",
    size: "short",
    enabled: true,
    error: false,
    supportingText: "Shown to other players in your groups and sessions.",
    errorText: "Enter your name",
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every knob: size, enabled, error and the texts. */
export const Playground: Story = {};

/** You can clear the field and type into it. */
export const Interactive: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "Name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Aisha Tan");
    await expect(input).toHaveValue("Aisha Tan");
    await expect(input).toHaveAccessibleDescription("Shown to other players in your groups and sessions.");
  },
};

/** Disabled: greyed out and typing does nothing. */
export const Disabled: Story = {
  args: { enabled: false },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "Name" });
    await expect(input).toBeDisabled();
    await userEvent.type(input, "xyz", { pointerEventsCheck: 0 });
    await expect(input).toHaveValue(SHORT_VALUE);
  },
};

/** Error: red message, the input is marked invalid, and screen readers read the error with it. */
export const WithError: Story = {
  args: { error: true, size: "short" },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "Name" });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription("Enter your name");
  },
};

/** A long value stays inside the field (it scrolls rather than overflowing). */
export const LongValue: Story = { args: { size: "long", label: "Group name", placeholder: "e.g. Weekend Tennis Crew" } };

export const Email: Story = {
  args: { type: "email", label: "Email", placeholder: "name@example.com", supportingText: "" },
};

/** Two fields on one page (as on the Docs page): each must point at its own label and message. */
export const TwoFieldsOnOnePage: Story = {
  render: (args) => (
    <div className="space-y-6">
      <TextField {...args} label="Name" supportingText="Shown to other players." />
      <TextField {...args} label="Group name" error errorText="Enter a group name" />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription("Shown to other players.");
    const groupName = canvas.getByRole("textbox", { name: "Group name" });
    await expect(groupName).toHaveAttribute("aria-invalid", "true");
    await expect(groupName).toHaveAccessibleDescription("Enter a group name");
  },
};
