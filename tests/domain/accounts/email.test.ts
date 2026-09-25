import { Email } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Email", () => {
  test("constructor_WhenStandardAddress_PreservesExactAddress", () => {
    // Arrange
    const address = "owner@example.com";

    // Act
    const email = new Email(address);

    // Assert
    expect(email.toString()).toBe(address);
  });

  test("constructor_WhenMixedCaseAndPlusTag_PreservesExactAddress", () => {
    // Arrange
    const address = "Owner+bookings@Example.COM";

    // Act
    const email = new Email(address);

    // Assert
    expect(email.toString()).toBe(address);
  });

  test("constructor_WhenLocalhostDomain_PreservesExactAddress", () => {
    // Arrange
    const address = "owner@localhost";

    // Act
    const email = new Email(address);

    // Assert
    expect(email.toString()).toBe(address);
  });

  test("constructor_WhenAddressHasEmpty_ThrowsInvalidInput", () => {
    // Arrange
    const address = "";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasWhitespaceOnly_ThrowsInvalidInput", () => {
    // Arrange
    const address = " ";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasMissingAtSign_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner.example.com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasMissingLocalPart_ThrowsInvalidInput", () => {
    // Arrange
    const address = "@example.com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasMissingDomain_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasConsecutiveAtSigns_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@@example.com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasMultipleAtSigns_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@example@com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasLeadingSpace_ThrowsInvalidInput", () => {
    // Arrange
    const address = " owner@example.com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasTrailingSpace_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@example.com ";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasSpaceInLocalPart_ThrowsInvalidInput", () => {
    // Arrange
    const address = "own er@example.com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasSpaceInDomain_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@exam ple.com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasTab_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner\t@example.com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasTrailingNewline_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@example.com\n";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasTrailingCrLf_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@example.com\r\n";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasUnicodeLineSeparator_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@example.com\u2028";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenAddressHasNonBreakingSpace_ThrowsInvalidInput", () => {
    // Arrange
    const address = "owner@\u00a0example.com";

    // Act & Assert
    expect(() => new Email(address)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenMutationIsAttempted_PreservesPublicSurface", () => {
    // Arrange
    const email = new Email("owner@example.com");

    // Act
    const valueChanged = Reflect.set(email, "value", "other@example.com");
    const methodChanged = Reflect.set(
      email,
      "toString",
      () => "other@example.com",
    );

    // Assert
    expect(Object.isFrozen(email)).toBe(true);
    expect(valueChanged).toBe(false);
    expect(methodChanged).toBe(false);
    expect(email.toString()).toBe("owner@example.com");
  });

  test("equals_WhenSameText_ReturnsTrue", () => {
    // Arrange
    const email = new Email("Owner@example.com");
    const other = new Email("Owner@example.com");

    // Act
    const equalAddresses = email.equals(other);

    // Assert
    expect(equalAddresses).toBe(true);
  });

  test("equals_WhenDifferentLocalCase_ReturnsFalse", () => {
    // Arrange
    const email = new Email("Owner@example.com");
    const other = new Email("owner@example.com");

    // Act
    const equalAddresses = email.equals(other);

    // Assert
    expect(equalAddresses).toBe(false);
  });

  test("equals_WhenDifferentDomainCase_ReturnsFalse", () => {
    // Arrange
    const email = new Email("Owner@example.com");
    const other = new Email("Owner@EXAMPLE.COM");

    // Act
    const equalAddresses = email.equals(other);

    // Assert
    expect(equalAddresses).toBe(false);
  });

  test("equals_WhenDifferentAddress_ReturnsFalse", () => {
    // Arrange
    const email = new Email("Owner@example.com");
    const other = new Email("other@example.com");

    // Act
    const equalAddresses = email.equals(other);

    // Assert
    expect(equalAddresses).toBe(false);
  });
});
