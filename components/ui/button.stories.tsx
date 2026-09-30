import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { Button } from "./button";

/** Records form submissions in the form stories below (cleared before each story). */
const submitted = fn();

const VARIANTS = ["default", "info", "destructive", "outline", "secondary", "ghost", "link"] as const;
const SIZES = ["default", "sm", "lg", "icon"] as const;

const meta = {
  title: "Design system/Button",
  component: Button,
  parameters: {
    docs: {
      description: {
        component:
          "The shadcn/ui button with the mockups' colours plus an `info` (slate-blue) variant. " +
          "It defaults to `type=\"button\"`, so it never submits a form by accident; pass `type=\"submit\"` for form buttons. " +
          "Use `asChild` to style a `<Link>` as a button.",
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: VARIANTS,
      description: "Visual style. `destructive` for irreversible actions, `outline` for secondary actions.",
      table: { defaultValue: { summary: "default" } },
    },
    size: {
      control: "select",
      options: SIZES,
      description: "Height and padding. `icon` is a square button for a single icon.",
      table: { defaultValue: { summary: "default" } },
    },
    type: {
      control: "select",
      options: ["button", "submit", "reset"],
      description: "HTML button type. Defaults to `button`; only `submit` submits a form.",
      table: { defaultValue: { summary: "button" } },
    },
    disabled: { control: "boolean", description: "Greys the button out and ignores clicks." },
    asChild: { control: false, description: "Render the child element (e.g. a `<Link>`) with button styles." },
    children: { control: "text", description: "The label." },
    onClick: { control: false },
  },
  args: { children: "Join session", onClick: fn() },
  beforeEach: () => {
    submitted.mockClear();
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Change the variant, size, label and disabled state in Controls. */
export const Playground: Story = {
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button", { name: "Join session" });
    await expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

/** Every variant side by side. */
export const AllVariants: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      {VARIANTS.map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

/** Every size side by side (`icon` holds a single character here). */
export const AllSizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="default">
        Default
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
      <Button {...args} size="icon" aria-label="Add">
        +
      </Button>
    </div>
  ),
};

export const Destructive: Story = { args: { variant: "destructive", children: "Delete account" } };

export const Disabled: Story = {
  args: { disabled: true, children: "Saving…" },
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button", { name: "Saving…" });
    await expect(button).toBeDisabled();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

/** Inside a real form, a plain Button does NOT submit it (it defaults to type="button"). */
export const DefaultButtonDoesNotSubmitForm: Story = {
  args: { children: "Show password" },
  render: (args) => (
    <form
      aria-label="Log in"
      onSubmit={(event) => {
        event.preventDefault();
        submitted();
      }}
    >
      <Button {...args} />
    </form>
  ),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show password" }));
    await expect(args.onClick).toHaveBeenCalledOnce();
    await expect(submitted).not.toHaveBeenCalled();
  },
};

/** With type="submit", the Button submits its form exactly once per click. */
export const SubmitButtonSubmitsFormOnce: Story = {
  args: { type: "submit", children: "Log in" },
  render: (args) => (
    <form
      aria-label="Log in"
      onSubmit={(event) => {
        event.preventDefault();
        submitted();
      }}
    >
      <Button {...args} />
    </form>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Log in" }));
    await expect(submitted).toHaveBeenCalledOnce();
  },
};