package com.cardprogramming.app;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/** Runs JS-generated wire frames through the same validator used by SparkBlePlugin. */
public final class ProgramFrameTest {
    public static void main(String[] args) throws Exception {
        if (ProgramFrame.valid(null)) throw new AssertionError("null frame accepted");
        int count = 0;
        try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = input.readLine()) != null) {
                String[] fields = line.split("\t", -1);
                if (fields.length != 3 || fields[1].length() % 2 != 0)
                    throw new AssertionError("Malformed test case: " + line);
                byte[] bytes = new byte[fields[1].length() / 2];
                for (int i = 0; i < bytes.length; i++)
                    bytes[i] = (byte) Integer.parseInt(fields[1].substring(i * 2, i * 2 + 2), 16);
                boolean expected = fields[0].equals("accept");
                boolean actual = ProgramFrame.valid(bytes);
                if (actual != expected)
                    throw new AssertionError(fields[2] + ": expected " + expected + ", received " + actual
                        + " (" + fields[1] + ")");
                count++;
            }
        }
        if (count == 0) throw new AssertionError("No wire frames provided");
        System.out.println("PASS Android ProgramFrame: " + count + " JS-generated frame cases plus null input.");
    }
}
