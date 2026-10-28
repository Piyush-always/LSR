/*
  CNC Shield V3 feeder controller
  Arduino Uno + CNC Shield V3 + A4988

  Commands at 115200 baud:
    LOAD HEART / LOAD RECTANGLE / LOAD CIRCLE
    FEED UP HEART / FEED UP RECTANGLE / FEED UP CIRCLE
    REMOVE RECTANGLE

  Axis mapping: X -> HEART, Y -> RECTANGLE, Z -> CIRCLE.
  Limit switches are active LOW with INPUT_PULLUP.
  LOAD moves toward the assigned limit, then backs off 400 steps.
  FEED UP moves the assigned axis upward 400 steps after engraving completes.
*/

const int X_STEP = 2, X_DIR = 5, X_LIMIT = 9;
const int Y_STEP = 3, Y_DIR = 6, Y_LIMIT = 10;
const int Z_STEP = 4, Z_DIR = 7, Z_LIMIT = 11;
// CNC Shield V3 auxiliary A driver: STEP=D12, DIR=D13; shares ENABLE=D8.
const int A_STEP = 12, A_DIR = 13;
const int A_LIMIT = A0;
const int ENABLE_PIN = 8;  // Active LOW

const long STEPS_PER_REV = 200;
const int ROTATIONS = 10;
const int STEP_PERIOD_US = 2000;
const int BACKOFF_STEPS = 400;
const int FEED_UP_STEPS = 200;
const long A_CLOCKWISE_STEPS = 3200;
const long A_ANTICLOCKWISE_STEPS = 3000;
const int A_STEP_DELAY_US = 2000;
const int A_CLOCKWISE_DIR = HIGH;
const int A_ANTICLOCKWISE_DIR = LOW;
const int DOWN_DIR = LOW;
const int UP_DIR = HIGH;
const long MAX_TRAVEL_STEPS = STEPS_PER_REV * ROTATIONS;

bool limitPressed(int pin) { return digitalRead(pin) == LOW; }

void pulseStep(int pin) {
  digitalWrite(pin, HIGH);
  delayMicroseconds(10);
  digitalWrite(pin, LOW);
  delayMicroseconds(STEP_PERIOD_US);
}

void moveSteps(int stepPin, int dirPin, int direction, long count) {
  digitalWrite(dirPin, direction);
  delayMicroseconds(50);
  for (long i = 0; i < count; i++) pulseStep(stepPin);
}

bool moveAxisToLimit(const char* shape, int stepPin, int dirPin, int limitPin) {
  if (limitPressed(limitPin)) {
    Serial.print("ERROR "); Serial.print(shape); Serial.println(" LIMIT_ALREADY_PRESSED");
    return false;
  }

  digitalWrite(dirPin, DOWN_DIR);
  delayMicroseconds(50);
  for (long step = 0; step < MAX_TRAVEL_STEPS; step++) {
    if (limitPressed(limitPin)) {
      moveSteps(stepPin, dirPin, UP_DIR, BACKOFF_STEPS);
      return true;
    }
    pulseStep(stepPin);
  }

  if (limitPressed(limitPin)) {
    moveSteps(stepPin, dirPin, UP_DIR, BACKOFF_STEPS);
    return true;
  }
  return false;
}

void loadShape(const char* shape, int stepPin, int dirPin, int limitPin) {
  digitalWrite(ENABLE_PIN, LOW);
  Serial.print("BUSY "); Serial.println(shape);
  if (moveAxisToLimit(shape, stepPin, dirPin, limitPin)) {
    Serial.print("READY "); Serial.println(shape);
  } else {
    Serial.print("ERROR "); Serial.print(shape); Serial.println(" LIMIT_NOT_HIT");
  }
}

void feedUp(const char* shape, int stepPin, int dirPin) {
  digitalWrite(ENABLE_PIN, LOW);
  Serial.print("BUSY UP "); Serial.println(shape);
  moveSteps(stepPin, dirPin, UP_DIR, FEED_UP_STEPS);
  Serial.print("READY UP "); Serial.println(shape);
}

bool moveAxisA(long steps, int direction, bool checkLimit) {
  digitalWrite(A_DIR, direction);
  delayMicroseconds(50);
  for (long i = 0; i < steps; i++) {
    if (checkLimit && limitPressed(A_LIMIT)) {
      Serial.println("LIMIT HIT - MOTOR STOPPED");
      return false;
    }
    digitalWrite(A_STEP, HIGH);
    delayMicroseconds(10);
    digitalWrite(A_STEP, LOW);
    delayMicroseconds(A_STEP_DELAY_US);
  }
  return true;
}

void removeRectangle() {
  digitalWrite(ENABLE_PIN, LOW);
  Serial.println("BUSY REMOVE RECTANGLE");

  const bool clockwiseCompleted = moveAxisA(A_CLOCKWISE_STEPS, A_CLOCKWISE_DIR, true);
  delay(500);
  if (!clockwiseCompleted) {
    Serial.println("REMOVAL: moving away from limit");
    moveAxisA(A_ANTICLOCKWISE_STEPS, A_ANTICLOCKWISE_DIR, false);
  } else {
    Serial.println("REMOVAL: anticlockwise movement");
    moveAxisA(A_ANTICLOCKWISE_STEPS, A_ANTICLOCKWISE_DIR, true);
  }
  Serial.println("READY REMOVE RECTANGLE");
}

void processCommand(String command) {
  command.trim(); command.toUpperCase();
  if (command == "LOAD HEART") loadShape("HEART", X_STEP, X_DIR, X_LIMIT);
  else if (command == "LOAD RECTANGLE") loadShape("RECTANGLE", Y_STEP, Y_DIR, Y_LIMIT);
  else if (command == "LOAD CIRCLE") loadShape("CIRCLE", Z_STEP, Z_DIR, Z_LIMIT);
  else if (command == "FEED UP HEART") feedUp("HEART", X_STEP, X_DIR);
  else if (command == "FEED UP RECTANGLE") feedUp("RECTANGLE", Y_STEP, Y_DIR);
  else if (command == "FEED UP CIRCLE") feedUp("CIRCLE", Z_STEP, Z_DIR);
  else if (command == "REMOVE RECTANGLE") removeRectangle();
  else Serial.println("ERROR UNKNOWN_COMMAND");
}

void setup() {
  Serial.begin(115200);
  pinMode(X_STEP, OUTPUT); pinMode(X_DIR, OUTPUT); pinMode(X_LIMIT, INPUT_PULLUP);
  pinMode(Y_STEP, OUTPUT); pinMode(Y_DIR, OUTPUT); pinMode(Y_LIMIT, INPUT_PULLUP);
  pinMode(Z_STEP, OUTPUT); pinMode(Z_DIR, OUTPUT); pinMode(Z_LIMIT, INPUT_PULLUP);
  pinMode(A_STEP, OUTPUT); pinMode(A_DIR, OUTPUT);
  pinMode(A_LIMIT, INPUT_PULLUP);
  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(X_STEP, LOW); digitalWrite(Y_STEP, LOW); digitalWrite(Z_STEP, LOW); digitalWrite(A_STEP, LOW);
  digitalWrite(ENABLE_PIN, LOW);
  Serial.println("FEEDER READY");
}

void loop() {
  if (Serial.available() > 0) processCommand(Serial.readStringUntil('\n'));
}
