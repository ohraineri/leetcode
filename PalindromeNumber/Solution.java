package PalindromeNumber;

public class Solution {
    public boolean isPalindrome(int x) {
        int digitsNumber = (int)Math.log10(x) + 1;

        if(x < 0)
            return false;

        for(int i = 0; i < digitsNumber; i++) {
            if((int)(x / Math.pow(10, digitsNumber - i) % 10) != (int)(x % Math.pow(10, i) / Math.pow(10, i - 1)))
                return false;
        }
        return true;
    }
}
