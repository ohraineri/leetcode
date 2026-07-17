public class TwoSun {
    public int[] twoSum(int[] nums, int target) {
        for (int i = 0; i < nums.length; i++) {
            for (int y = 0; y < nums.length; y++) {
                if(i == y)
                    continue;
                if (nums[i] + nums[y] == target)
                    return new int[] {i, y};
            }
        }
        return null;
    }
}
